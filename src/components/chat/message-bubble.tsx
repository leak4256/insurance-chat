import ReactMarkdown from "react-markdown";
import type { UIMessage } from "ai";
import { cn } from "@/lib/utils";
import { extractSources, SourceChips } from "./sources";

function messageText(message: UIMessage): string {
  return message.parts
    .filter((p): p is Extract<(typeof message.parts)[number], { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("");
}

function isSearching(message: UIMessage): boolean {
  return message.parts.some(
    (p) =>
      p.type === "tool-search_knowledge" &&
      "state" in p &&
      (p.state === "input-streaming" || p.state === "input-available"),
  );
}

export function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";
  const text = messageText(message);
  const sources = isUser ? [] : extractSources(message);

  return (
    <div className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm",
          isUser
            ? "brand-fill rounded-tl-md bg-primary text-primary-foreground"
            : "rounded-tr-md border bg-card text-card-foreground",
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap break-words">{text}</p>
        ) : (
          <>
            {!text && isSearching(message) && (
              <p className="text-muted-foreground">מחפש במאגר הידע…</p>
            )}
            <div className="chat-markdown">
              <ReactMarkdown>{text}</ReactMarkdown>
            </div>
            <SourceChips sources={sources} />
          </>
        )}
      </div>
    </div>
  );
}

export function TypingIndicator() {
  return (
    <div className="flex w-full justify-start" aria-label="העוזר מקליד">
      <div className="rounded-2xl rounded-tr-md border bg-card px-4 py-3 shadow-sm">
        <span className="flex gap-1">
          <span className="typing-dot h-2 w-2 rounded-full bg-muted-foreground" />
          <span className="typing-dot h-2 w-2 rounded-full bg-muted-foreground" />
          <span className="typing-dot h-2 w-2 rounded-full bg-muted-foreground" />
        </span>
      </div>
    </div>
  );
}
