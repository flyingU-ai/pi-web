import type { Locale, TranslationParams } from "./types";

type MessagesByLocale = Record<string, Record<string, string>>;

/**
 * 替换翻译消息中的简单插值占位符。
 * @param message 原始翻译消息
 * @param params 插值参数
 * @returns 完成参数替换后的消息
 */
export function interpolateMessage(message: string, params: TranslationParams = {}): string {
  return message.replace(/\{([\w.-]+)\}/g, (token, name: string) => {
    const value = params[name];
    return value === undefined ? token : String(value);
  });
}

/**
 * 从当前语言和英语语言包中解析消息。
 * @param locale 当前语言
 * @param key 翻译 key
 * @param messages 各语言的消息字典
 * @param params 可选的插值参数
 * @returns 翻译结果，缺失时返回 key
 */
export function translateMessage(
  locale: Locale,
  key: string,
  messages: MessagesByLocale,
  params: TranslationParams = {},
): string {
  const message = messages[locale]?.[key] ?? messages.en?.[key];
  if (message === undefined) {
    if (process.env.NODE_ENV !== "production") console.warn(`[i18n] Missing translation: ${key}`);
    return key;
  }
  return interpolateMessage(message, params);
}

/**
 * 按当前语言格式化相对时间。
 * @param date 要格式化的时间
 * @param locale 当前语言
 * @param now 用于测试或特殊场景的当前时间
 * @returns locale-aware 的相对时间文本
 */
export function formatRelativeTime(date: Date | string, locale: Locale, now = new Date()): string {
  const target = date instanceof Date ? date : new Date(date);
  const diffMs = target.getTime() - now.getTime();
  const absMs = Math.abs(diffMs);
  const [unit, divisor] = absMs < 60_000
    ? ["second", 1_000]
    : absMs < 3_600_000
      ? ["minute", 60_000]
      : absMs < 86_400_000
        ? ["hour", 3_600_000]
        : ["day", 86_400_000];
  const value = Math.round(diffMs / divisor);
  return new Intl.RelativeTimeFormat(locale, { numeric: "always" }).format(value, unit as Intl.RelativeTimeFormatUnit);
}

/** 作业台时钟。机器和浏览器常是 UTC，界面仍显示北京时间。 */
export const DISPLAY_TIME_ZONE = "Asia/Shanghai";

function zonedDay(date: Date, timeZone = DISPLAY_TIME_ZONE): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * 绝对时间：今天只显示时刻，更早的带上日期。时区固定为北京时间，语言跟界面。
 * @param input 毫秒时间戳、Date 或 ISO 字符串
 * @param locale 当前语言
 * @param now 用于测试或特殊场景的当前时间
 * @returns 北京时间文本；无法解析时返回空字符串
 */
export function formatAbsoluteTime(input: Date | string | number, locale: Locale | string, now = new Date()): string {
  const target = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(target.getTime())) return "";
  const time = target.toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: DISPLAY_TIME_ZONE,
  });
  if (zonedDay(target) === zonedDay(now)) return time;
  const date = target.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    year: zonedDay(target).slice(0, 4) === zonedDay(now).slice(0, 4) ? undefined : "numeric",
    timeZone: DISPLAY_TIME_ZONE,
  });
  return `${date} ${time}`;
}

/**
 * 今天只显示北京时间的时刻；更早的时间和会话列表一样用相对时间。
 * @param timestamp 毫秒时间戳
 * @param locale 当前语言
 * @param now 用于测试或特殊场景的当前时间
 * @returns 今天的时刻，或更早时间的相对时间文本
 */
export function formatUpdatedTime(timestamp: number, locale: Locale, now = new Date()): string {
  const target = new Date(timestamp);
  if (Number.isNaN(target.getTime())) return "";
  if (zonedDay(target) === zonedDay(now)) return formatAbsoluteTime(target, locale, now);
  return formatRelativeTime(target, locale, now);
}
