function initializeAllCodeGroups() {
  // Find all code group elements that need initialization
  document.querySelectorAll('.code-group:not([data-code-group-initialized])').forEach(group => {
    initializeCodeGroup(group);
  });
}

function initializeCodeGroup(group) {
  if (group.hasAttribute('data-code-group-initialized')) {
    return;
  }
  
  console.log("[Initialize] CodeGroup", group.id || "unnamed");

  const primaryTabsContainer = group.querySelector(".primary-tabs");
  const primaryTabs = group.querySelectorAll(".primary-tabs .code-group-tab");
  const secondaryTabs = group.querySelectorAll(".secondary-tabs .code-group-tab");
  const panels = group.querySelectorAll(".code-panel");
  const leftIndicator = group.querySelector(".scroll-indicators-overlay .scroll-indicator.left");
  const rightIndicator = group.querySelector(".scroll-indicators-overlay .scroll-indicator.right");

  // Position scroll indicators relative to the container
  function updateScrollIndicatorPositions() {
    if (!primaryTabsContainer || !leftIndicator || !rightIndicator) return;
    const rect = primaryTabsContainer.getBoundingClientRect();
    
    leftIndicator.style.position = 'absolute';
    rightIndicator.style.position = 'absolute';
    
    leftIndicator.style.top = '50%';
    rightIndicator.style.top = '50%';
    
    leftIndicator.style.left = '0';
    rightIndicator.style.right = '0';
  }

  // Check for overflow
  function checkOverflow() {
    if (!primaryTabsContainer) return;
    
    const hasRightOverflow = primaryTabsContainer.scrollLeft < primaryTabsContainer.scrollWidth - primaryTabsContainer.clientWidth;
    const hasLeftOverflow = primaryTabsContainer.scrollLeft > 0;
    
    primaryTabsContainer.classList.toggle('has-overflow', hasRightOverflow);
    primaryTabsContainer.classList.toggle('has-start-overflow', hasLeftOverflow);
  }

  // Handle scroll indicator clicks
  if (leftIndicator) {
    leftIndicator.addEventListener('click', () => {
      primaryTabsContainer.scrollBy({
        left: -200,
        behavior: 'smooth'
      });
    });
  }

  if (rightIndicator) {
    rightIndicator.addEventListener('click', () => {
      primaryTabsContainer.scrollBy({
        left: 200,
        behavior: 'smooth'
      });
    });
  }

  // Check on load and resize
  checkOverflow();
  updateScrollIndicatorPositions();
  window.addEventListener('resize', () => {
    checkOverflow();
    updateScrollIndicatorPositions();
  });

  // Check on scroll
  if (primaryTabsContainer) {
    primaryTabsContainer.addEventListener('scroll', checkOverflow);
  }

  function updateActivePanels() {
    const activeType = group.querySelector(".primary-tabs .code-group-tab.active")?.dataset.tab;
    const activeStorage = group.querySelector(".secondary-tabs .code-group-tab.active")?.dataset.tab;
    
    if (!activeType || !activeStorage) return;

    const targetPanel = `${activeType}-${activeStorage}`;
    panels.forEach((panel) => {
      panel.classList.toggle("active", panel.dataset.panel === targetPanel);
    });
  }

  function handleTabClick(tab, tabGroup) {
    tabGroup.forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    updateActivePanels();
  }

  primaryTabs.forEach((tab) => {
    tab.setAttribute('tabindex', '0');
    tab.addEventListener("click", () => handleTabClick(tab, primaryTabs));
    tab.addEventListener("keydown", (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleTabClick(tab, primaryTabs);
      }
    });
  });

  secondaryTabs.forEach((tab) => {
    tab.setAttribute('tabindex', '0');
    tab.addEventListener("click", () => handleTabClick(tab, secondaryTabs));
    tab.addEventListener("keydown", (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleTabClick(tab, secondaryTabs);
      }
    });
  });

  group.setAttribute('data-code-group-initialized', 'true');
}

// Initial run on DOM ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeAllCodeGroups);
} else {
  initializeAllCodeGroups();
}