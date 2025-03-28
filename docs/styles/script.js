// ActorCore custom scripts

// Inject script to set page attribute so we can style pages according to the current page
document.addEventListener("DOMContentLoaded", function () {
  // Add attribute on change
  function onPathChange() {
    console.log("Path changed to:", window.location.pathname);
    document.documentElement.setAttribute(
      "data-page",
      window.location.pathname
    );
  }
  onPathChange();

  // Swizzle state changes
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  history.pushState = function (...args) {
    originalPushState.apply(this, args);
    onPathChange();
  };

  history.replaceState = function (...args) {
    originalReplaceState.apply(this, args);
    onPathChange();
  };

  // Add events
  window.addEventListener("popstate", onPathChange);
  window.addEventListener("pushstate", onPathChange);
  window.addEventListener("replacestate", onPathChange);
});

// Global function for copying commands
window.copyCommand = function (element) {
  // Get the container if passed element isn't the container itself
  const container = element.classList.contains("copy-command-container")
    ? element
    : element.closest(".copy-command-container");

  if (!container) return;

  // Find the command text
  const commandTextElement = container.querySelector(".copy-command-text");
  if (!commandTextElement) return;

  const commandText = commandTextElement.textContent.trim();

  // Strip the leading $ if present
  const textToCopy = commandText.startsWith("$")
    ? commandText.substring(1).trim()
    : commandText;

  // Copy to clipboard
  navigator.clipboard.writeText(textToCopy);

  // Show the check icon temporarily
  const iconContainer = container.querySelector(".icon-container");
  if (!iconContainer) return;

  // Toggle copied class to show the check icon
  iconContainer.classList.add("copied");

  // Reset after animation completes
  setTimeout(() => {
    iconContainer.classList.remove("copied");
  }, 1000);
};
