// scripts/update-floating-ai.js
const fs = require('fs');
const filePath = 'd:/hisabboi/cashbook-frontend/src/pages/Ai/FloatingAI.tsx';
let code = fs.readFileSync(filePath, 'utf8');

// 1. Add imports for AnalyticsView, CommandAutocomplete, and types
const importMarker = 'import { enumLabel } from "../../i18n/labels";';
const newImports = `import { enumLabel } from "../../i18n/labels";
import { AnalyticsView } from "./components/AnalyticsView";
import { CommandAutocomplete } from "./components/CommandAutocomplete";
import type { AnalyticsResult } from "./types";`;

code = code.replace(importMarker, newImports);

// 2. Update Message interface
const messageInterfaceOld = `interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp?: number;
  error?: boolean;
}`;

const messageInterfaceNew = `interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp?: number;
  error?: boolean;
  analytics?: AnalyticsResult;
}`;

code = code.replace(messageInterfaceOld, messageInterfaceNew);

// 3. Update callAI function
const callAiOld = `const callAI = async (
  businessId: string,
  messages: Message[],
  t: TFunction,
): Promise<string> => {
  const { data } = await api.post("/ai/chat", { businessId, messages });
  return data.data?.reply ?? t("ai.noReply");
};`;

const callAiNew = `const callAI = async (
  businessId: string,
  messages: Message[],
  t: TFunction,
): Promise<{ reply: string; analytics?: AnalyticsResult }> => {
  const { data } = await api.post("/ai/chat", { businessId, messages });
  return {
    reply: data.data?.reply ?? t("ai.noReply"),
    analytics: data.data?.analytics,
  };
};`;

code = code.replace(callAiOld, callAiNew);

// 4. Update Bubble component to render AnalyticsView
const bubbleOld = `<div className={\`max-w-[80%] flex flex-col \${isUser ? "items-end" : "items-start"}\`}>
        <div
          className="text-sm leading-relaxed"
          style={{
            background: isUser
              ? "#10b981"
              : isError
                ? "rgba(239,68,68,0.08)"
                : "var(--surface-4)",
            border: isError ? "1px solid rgba(239,68,68,0.25)" : "none",
            color: isUser ? "#022c22" : isError ? "#ef4444" : "var(--text-primary)",
            borderRadius: isUser ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
            padding: "10px 14px",
          }}
        >
          {isUser ? msg.content : <RichText text={msg.content} />}
        </div>`;

const bubbleNew = `<div className={\`\${msg.analytics ? "w-full max-w-[95%]" : "max-w-[80%]"} flex flex-col \${isUser ? "items-end" : "items-start"}\`}>
        <div
          className="text-sm leading-relaxed"
          style={{
            background: isUser
              ? "#10b981"
              : isError
                ? "rgba(239,68,68,0.08)"
                : "var(--surface-4)",
            border: isError ? "1px solid rgba(239,68,68,0.25)" : "none",
            color: isUser ? "#022c22" : isError ? "#ef4444" : "var(--text-primary)",
            borderRadius: isUser ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
            padding: "10px 14px",
          }}
        >
          {isUser ? msg.content : <RichText text={msg.content} />}
          {!isUser && msg.analytics && (
            <AnalyticsView analytics={msg.analytics} />
          )}
        </div>`;

code = code.replace(bubbleOld, bubbleNew);

// 5. Update handleSelectBusiness greeting call
const greetingCallOld = `const reply = await callAI(biz._id, [firstMsg], t);
      setMessages([{ role: "assistant", content: reply, timestamp: Date.now() }]);`;

const greetingCallNew = `const res = await callAI(biz._id, [firstMsg], t);
      setMessages([{ role: "assistant", content: res.reply, analytics: res.analytics, timestamp: Date.now() }]);`;

code = code.replace(greetingCallOld, greetingCallNew);

// 6. Update handleSend response handling
const handleSendOld = `      const reply = await callAI(selected._id, newMsgs, t);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: reply, timestamp: Date.now() },
      ]);`;

const handleSendNew = `      const res = await callAI(selected._id, newMsgs, t);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: res.reply, analytics: res.analytics, timestamp: Date.now() },
      ]);`;

code = code.replace(handleSendOld, handleSendNew);

// 7. Update handleRetry response handling
const handleRetryOld = `      const reply = await callAI(selected._id, lastPayloadRef.current, t);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: reply, timestamp: Date.now() },
      ]);`;

const handleRetryNew = `      const res = await callAI(selected._id, lastPayloadRef.current, t);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: res.reply, analytics: res.analytics, timestamp: Date.now() },
      ]);`;

code = code.replace(handleRetryOld, handleRetryNew);

// 8. Update input container with CommandAutocomplete and quick chips
const inputContainerOld = `                {/* Input */}
                <div
                  className="flex-shrink-0"
                  style={{ borderTop: "1px solid var(--border)" }}
                >
                <div className="px-4 pt-3 flex gap-2">`;

const inputContainerNew = `                {/* Quick Command Chips */}
                {!greeting && messages.length >= 1 && !thinking && (
                  <div className="px-4 pb-1.5 flex gap-1.5 overflow-x-auto no-scrollbar">
                    {['/report', '/sales', '/profit', '/expense', '/due', '/inventory'].map((cmd) => (
                      <button
                        key={cmd}
                        onClick={() => handleSend(cmd)}
                        className="px-2.5 py-1 rounded-lg text-[11px] font-medium whitespace-nowrap transition-all"
                        style={{
                          background: "rgba(16,185,129,0.08)",
                          border: "1px solid rgba(16,185,129,0.2)",
                          color: "#10b981",
                        }}
                      >
                        {cmd}
                      </button>
                    ))}
                  </div>
                )}

                {/* Input */}
                <div
                  className="flex-shrink-0 relative"
                  style={{ borderTop: "1px solid var(--border)" }}
                >
                <CommandAutocomplete
                  query={input}
                  visible={input.startsWith('/')}
                  onSelect={(cmd) => {
                    setInput(cmd + ' ');
                    inputRef.current?.focus();
                  }}
                />
                <div className="px-4 pt-3 flex gap-2">`;

code = code.replace(inputContainerOld, inputContainerNew);

fs.writeFileSync(filePath, code, 'utf8');
console.log('FloatingAI.tsx updated successfully.');
