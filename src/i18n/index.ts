import en from "./en.json";
import imported from "./imported.json";
import mobile from "./mobile.json";
import type { Locale } from "../domain/types";
export type TextKey = keyof typeof en;
export function translator(
  locale: Locale,
  sourceValues: Readonly<Record<string, string>> = {},
) {
  const pack =
    locale === "en"
      ? {}
      : {
          ...(imported as Record<string, Record<string, string>>)[locale],
          ...(mobile as Record<string, Record<string, string>>)[locale],
        };
  return (key: TextKey | string): string => {
    const source = (en as Record<string, string>)[key];
    const custom =
      source &&
      sourceValues &&
      Object.prototype.hasOwnProperty.call(sourceValues, source)
        ? sourceValues[source]
        : undefined;
    const placeholders = (value: string) =>
      [...value.matchAll(/\{(\w+)\}/g)]
        .map((m) => m[1])
        .sort()
        .join("|");
    return typeof custom === "string" &&
      custom.trim() &&
      source &&
      placeholders(custom) === placeholders(source)
      ? custom
      : (pack[key] ?? source ?? en.unknownError);
  };
}
export function translationCoverage(locale: Locale) {
  return locale === "en"
    ? { translated: Object.keys(en).length, total: Object.keys(en).length }
    : {
        translated: Object.keys({
          ...imported[locale],
          ...mobile[locale],
        }).filter((key) => Object.prototype.hasOwnProperty.call(en, key))
          .length,
        total: Object.keys(en).length,
      };
}
export function detectLocale(tag: string): Locale {
  const key = tag.trim().split(/[-_]/)[0]?.toLowerCase();
  return key && Object.prototype.hasOwnProperty.call(imported, key)
    ? (key as Locale)
    : "en";
}
