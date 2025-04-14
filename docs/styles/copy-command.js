window.copyCommand = function(element) {
  const container = element.classList.contains("copy-command-container")
    ? element
    : element.closest(".copy-command-container");

  if (!container) return;

  const commandTextElement = container.querySelector(".copy-command-text");
  if (!commandTextElement) return;

  const commandText = commandTextElement.textContent.trim();
  const textToCopy = commandText.startsWith("$")
    ? commandText.substring(1).trim()
    : commandText;

  navigator.clipboard.writeText(textToCopy);

  const iconContainer = container.querySelector(".icon-container");
  if (!iconContainer) return;

  iconContainer.classList.add("copied");
  setTimeout(() => {
    iconContainer.classList.remove("copied");
  }, 1000);
}; 