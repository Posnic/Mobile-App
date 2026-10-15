import ExpoModulesCore
import Darwin

public final class PosnicSecurityModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PosnicSecurity")
    AsyncFunction("networkAddresses") { () -> [String] in
      var first: UnsafeMutablePointer<ifaddrs>?
      guard getifaddrs(&first) == 0 else { return [] }
      defer { freeifaddrs(first) }
      var cursor = first
      var addresses: [String] = []
      while let current = cursor {
        let entry = current.pointee
        cursor = entry.ifa_next
        let name = String(cString: entry.ifa_name)
        guard ["en", "bridge", "ap"].contains(where: { name.hasPrefix($0) }),
              entry.ifa_flags & UInt32(IFF_UP) != 0,
              let address = entry.ifa_addr, address.pointee.sa_family == UInt8(AF_INET) else { continue }
        var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
        if getnameinfo(address, socklen_t(address.pointee.sa_len), &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST) == 0 {
          let value = String(cString: host)
          if !addresses.contains(value) { addresses.append(value) }
        }
      }
      return Array(addresses.prefix(4))
    }
    AsyncFunction("derivePinKey") { (pin: String, saltHex: String, promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          promise.resolve(try PosnicPinKey.derive(pin: pin, saltHex: saltHex))
        } catch {
          promise.reject("PIN_DERIVATION_FAILED", "PIN setup could not complete")
        }
      }
    }
  }
}
