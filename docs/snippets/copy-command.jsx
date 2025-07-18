import { Icon } from "@/components/Icon";
import { useState } from "react";

export const CopyCommand = ({ children, command }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const commandText = command || children;
    const textToCopy = commandText.startsWith("$")
      ? commandText.substring(1).trim()
      : commandText;

    navigator.clipboard.writeText(textToCopy);

    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 1000);
  };

  return (
    <div className="copy-command-container" onClick={handleCopy}>
      <div className="copy-command-icon">
        <Icon icon="arrow-right" iconType="solid" color="white" />
      </div>
      <div className="copy-command-text">
        {command || children}
      </div>
      <div className={`icon-container ${copied ? "copied" : ""}`}>
        <div className="copy-icon">
          <Icon icon="copy" />
        </div>
        <div className="check-icon">
          <Icon icon="check" />
        </div>
      </div>
    </div>
  );
};