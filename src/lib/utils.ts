import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * קישור למסמך מקור. PDF נפתח בדף הצפייה `/source`, שמטמיע את המסמך — קישור
 * ישיר ל-PDF גורם בחלק מהדפדפנים להורדת הקובץ במקום להצגתו. דף אינטרנט רגיל
 * נפתח כרגיל בכתובת שלו.
 */
export function sourceHref(url: string, isPdf = /\.pdf($|[?#])/i.test(url)): string {
  return isPdf ? `/source?url=${encodeURIComponent(url)}` : url;
}
