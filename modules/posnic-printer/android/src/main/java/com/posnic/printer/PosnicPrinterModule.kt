package com.posnic.printer

import android.bluetooth.BluetoothManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** Bluetooth Classic SPP, ESC/POS raster profile. Transport submission is not paper confirmation. */
class PosnicPrinterModule : Module() {
  private val running = AtomicBoolean(false)
  private fun adapter() = (appContext.reactContext?.getSystemService(BluetoothManager::class.java)
    ?: error("deviceUnavailable")).adapter ?: error("deviceUnavailable")

  override fun definition() = ModuleDefinition {
    Name("PosnicPrinter")
    AsyncFunction("derivePinKey") { pin: String, saltHex: String, promise: Promise ->
      // Dedicated worker: PIN setup neither blocks Hermes nor printer I/O.
      val worker = Executors.newSingleThreadExecutor()
      worker.execute {
        try {
          require(Regex("[0-9]{4,6}").matches(pin))
          require(Regex("[a-f0-9]{96}").matches(saltHex))
          val salt = saltHex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
          val spec = javax.crypto.spec.PBEKeySpec(pin.toCharArray(), salt, 600000, 256)
          try {
            val key = javax.crypto.SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
            try { promise.resolve(key.joinToString("") { "%02x".format(it.toInt() and 255) }) }
            finally { key.fill(0) }
          } finally { spec.clearPassword(); salt.fill(0) }
        } catch (error: Exception) { promise.reject("PIN_DERIVATION_FAILED", "PIN setup could not complete. Try again.", null) }
        finally { worker.shutdown() }
      }
    }
    AsyncFunction("networkAddresses") {
      // Android can report CELLULAR while this phone hosts the shop hotspot.
      // Read only physical LAN/hotspot interfaces, never VPN or mobile carriers.
      java.util.Collections.list(java.net.NetworkInterface.getNetworkInterfaces())
        .filter { it.isUp && !it.isLoopback && Regex("^(wlan|ap|swlan|softap|bridge|br|rndis|usb|eth).*", RegexOption.IGNORE_CASE).matches(it.name) }
        .flatMap { java.util.Collections.list(it.inetAddresses) }
        .filterIsInstance<java.net.Inet4Address>()
        .filter { it.isSiteLocalAddress && !it.isLoopbackAddress }
        .mapNotNull { it.hostAddress }.distinct().take(4)
    }
    AsyncFunction("pairedDevices") {
      val bluetooth = adapter()
      if (!bluetooth.isEnabled) error("deviceUnavailable")
      bluetooth.bondedDevices.map { mapOf("address" to it.address, "name" to (it.name ?: it.address)) }
    }
    AsyncFunction("usbDevices") { UsbPrinter(appContext.reactContext ?: error("deviceUnavailable")).devices() }
    AsyncFunction("requestUsbPermission") { address:String, promise:Promise ->
      UsbPrinter(appContext.reactContext ?: error("deviceUnavailable")).request(address,promise)
    }
    AsyncFunction("printReceipt") { address: String, text: String, width: Int, drawerPin: Int ->
      printDocument(address, text, width, drawerPin, false)
    }
    AsyncFunction("printPdf") { address: String, uri: String, width: Int, drawerPin: Int ->
      printDocument(address, uri, width, drawerPin, true)
    }
  }
  private fun printDocument(address: String, text: String, width: Int, drawerPin: Int, pdf: Boolean): Map<String, Any> {
      if (!running.compareAndSet(false, true)) error("printCheckPaper")
      var sent = false
      val pages = mutableListOf<Bitmap>()
      var socket: android.bluetooth.BluetoothSocket? = null
      var usbStream: java.io.OutputStream? = null
      val timer = Executors.newSingleThreadScheduledExecutor()
      try {
        require(width == 384 || width == 576)
        require(drawerPin in -1..1)
        require(text.length in 1..24000)
        val connect: () -> java.io.OutputStream
        if(address.startsWith("usb:")) {
          usbStream=UsbPrinter(appContext.reactContext ?: error("deviceUnavailable")).open(address)
          connect={usbStream ?: error("deviceUnavailable")}
        } else {
          val bluetooth = adapter()
          if (!bluetooth.isEnabled) error("deviceUnavailable")
          val device = bluetooth.bondedDevices.firstOrNull { it.address == address } ?: error("deviceUnavailable")
          socket=device.createRfcommSocketToServiceRecord(UUID.fromString("00001101-0000-1000-8000-00805f9b34fb"))
          val target=socket!!
          connect={target.connect();target.outputStream}
        }
        timer.schedule({try {socket?.close();usbStream?.close()} catch (_:Exception) {}},45,TimeUnit.SECONDS)
        if (pdf) {
          val path = java.io.File(android.net.Uri.parse(text).path ?: error("invalidFile")).canonicalFile
          val cache = (appContext.reactContext ?: error("deviceUnavailable")).cacheDir.canonicalFile
          require(path.path.startsWith(cache.path + java.io.File.separator) && path.length() <= 10000000)
          android.os.ParcelFileDescriptor.open(path, android.os.ParcelFileDescriptor.MODE_READ_ONLY).use { descriptor ->
            android.graphics.pdf.PdfRenderer(descriptor).use { renderer ->
              require(renderer.pageCount in 1..16)
              var totalHeight = 0
              for (index in 0 until renderer.pageCount) renderer.openPage(index).use { page ->
                val height = kotlin.math.ceil(page.height.toDouble() * width / page.width).toInt()
                totalHeight += height
                require(height > 0 && totalHeight <= 24000)
                val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
                pages.add(bitmap)
                Canvas(bitmap).drawColor(Color.WHITE)
                page.render(bitmap, null, null, android.graphics.pdf.PdfRenderer.Page.RENDER_MODE_FOR_PRINT)
              }
            }
          }
        } else {
          val paint = TextPaint().apply { color = Color.BLACK; textSize = 24f; isAntiAlias = true }
          val layout = StaticLayout.Builder.obtain(text, 0, text.length, paint, width - 24)
            .setAlignment(Layout.Alignment.ALIGN_NORMAL).setIncludePad(true).build()
          require(layout.height <= 24000)
          val bitmap = Bitmap.createBitmap(width, layout.height + 24, Bitmap.Config.ARGB_8888)
          pages.add(bitmap)
          Canvas(bitmap).apply { drawColor(Color.WHITE); translate(12f, 12f); layout.draw(this) }
        }
          val output = connect()
          // Mark uncertain before the first write: write() can fail after partial delivery.
          sent = true
          output.write(byteArrayOf(0x1b, 0x40))
          val bytesWide = width / 8
          for (bitmap in pages) {
          var bottom = bitmap.height
          if (pdf) {
            // Trim only trailing blank PDF page space; preserve all design content.
            val pixels = IntArray(width)
            while (bottom > 1) {
              bitmap.getPixels(pixels, 0, width, 0, bottom - 1, width, 1)
              if (pixels.any { Color.red(it) < 245 || Color.green(it) < 245 || Color.blue(it) < 245 }) break
              bottom--
            }
          }
          var top = 0
          while (top < bottom) {
            val height = minOf(128, bottom - top)
            val data = ByteArray(8 + bytesWide * height)
            data[0] = 0x1d; data[1] = 0x76; data[2] = 0x30; data[3] = 0
            data[4] = (bytesWide and 255).toByte(); data[5] = (bytesWide shr 8).toByte()
            data[6] = (height and 255).toByte(); data[7] = (height shr 8).toByte()
            for (y in 0 until height) for (x in 0 until width) {
              val pixel = bitmap.getPixel(x, top + y)
              if ((Color.red(pixel) * 299 + Color.green(pixel) * 587 + Color.blue(pixel) * 114) < 128000) {
                val index = 8 + y * bytesWide + x / 8
                data[index] = (data[index].toInt() or (0x80 shr (x % 8))).toByte()
              }
            }
            output.write(data)
            output.flush()
            top += height
          }
          }
          output.write(byteArrayOf(0x0a, 0x0a, 0x0a))
          // ESC p: 100 ms on, 400 ms off. Never included in tests or reprints.
          if (drawerPin >= 0) output.write(byteArrayOf(0x1b, 0x70, drawerPin.toByte(), 50, 200.toByte()))
          output.flush()
          return mapOf("state" to "submitted", "submitted" to true)
      } catch (_: Exception) {
        return mapOf("state" to if (sent) "unknown" else "failed", "submitted" to sent)
      } finally {
        try { socket?.close(); usbStream?.close() } catch (_: Exception) {}
        timer.shutdownNow()
        pages.forEach { it.recycle() }
        running.set(false)
      }
  }
}
