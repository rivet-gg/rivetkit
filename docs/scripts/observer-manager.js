// // Throttling with unique name to avoid conflicts
// let observerManagerThrottleTimer = null;
// const OBSERVER_MANAGER_THROTTLE_DELAY = 0; // ms
//
// // Run all component initializers - these functions are defined in other files
// function observerManagerRunAllInitializers() {
//   // Skip if already scheduled
//   if (observerManagerThrottleTimer) return;
//   console.log('[Observer] Observe changes');
//
//   // Always run particles initialization immediately to prevent flash
//   if (typeof observerInitialize === 'function') {
//     observerInitialize();
//   }
//
//   // Schedule throttled execution for other components
//   observerManagerThrottleTimer = setTimeout(() => {
//     // Run each component's init function directly
//     if (typeof initializeAllCodeGroups === 'function') initializeAllCodeGroups();
//     if (typeof initializeAllCopyCommands === 'function') initializeAllCopyCommands();
//
//     // Run particles again to catch any late additions
//     if (typeof observerInitialize === 'function') observerInitialize();
//
//     // Reset timer
//     observerManagerThrottleTimer = null;
//   }, OBSERVER_MANAGER_THROTTLE_DELAY);
// }
//
// // Create observer with unique name to avoid conflicts
// const observerManagerObserver = new MutationObserver(observerManagerRunAllInitializers);
//
// // Start observing
// observerManagerObserver.observe(document.body, {
//   childList: true,
//   subtree: true
// });
//
// // Initial run as soon as possible
// setTimeout(observerManagerRunAllInitializers, 0);
// observerManagerRunAllInitializers();
//
// // Cleanup on page unload
// window.addEventListener('unload', () => {
//   observerManagerObserver.disconnect();
//   if (observerManagerThrottleTimer) {
//     clearTimeout(observerManagerThrottleTimer);
//   }
// });
