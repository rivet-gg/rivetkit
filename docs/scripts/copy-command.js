function initializeAllCopyCommands() {
  // Find all copy command containers that need initialization
  document.querySelectorAll('.copy-command-container:not([data-copy-initialized])').forEach(container => {
    initializeCopyCommand(container);
  });
}

function initializeCopyCommand(container) {
  // Skip if already initialized
  if (container.hasAttribute('data-copy-initialized')) return;
  
  console.log("[Initialize] CopyCommand", container?.id || "unnamed");
  
  // Mark as initialized
  container.setAttribute('data-copy-initialized', 'true');
  
  // Attach click event handler to the container
  container.addEventListener('click', function() {
    copyCommand(this);
  });
}

function copyCommand(element) {
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
}

// Export the function for direct use
window.copyCommand = copyCommand;

// Initial run on DOM ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeAllCopyCommands);
} else {
  initializeAllCopyCommands();
}