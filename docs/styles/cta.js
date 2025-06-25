// CTA titles array
const CTA_TITLES = [
  "Performance in every act - thanks to Rivet Actors.",
  "Scale without drama - only with Rivet Actors.",
  "It's time your backend took center-stage - with Rivet Actors.",
  "SQLite the spotlight on performance - with Rivet Actors.",
  "Backend scalability: the SQL - starring Rivet Actors.",
  "Take your state to the edge - Rivet Actors makes it easy.",
  "No state fright - just scalability with Rivet Actors.",
  "Act now, deploy at the edge - with Rivet Actors.",
  "Lights, camera, serverless - powered by Rivet Actors.",
  "Your backend deserves a standing ovation - Rivet Actors delivers.",
  "Cue your backend's best performance - enter Rivet Actors.",
  "Backend performance worth applauding - only with Rivet Actors.",
  "Put your backend center-stage - with Rivet Actors.",
  "Make your backend the main actor - with Rivet Actors.",
  "Give your backend its big break - use Rivet Actors.",
  "Serverless, with no intermissions - powered by Rivet Actors.",
  "Set the stage for serverless success - with Rivet Actors."
];

function initializeAllCTAs() {
  // Find CTA container, looking for both the old class and potential new classes
  document.querySelectorAll('.cta-container:not([data-cta-initialized]), .cta-section:not([data-cta-initialized])').forEach(container => {
    // Skip if already initialized
    if (container.hasAttribute('data-cta-initialized')) return;
    
    console.log("[Initialize] CTA", container?.id || "unnamed");
    
    // Mark as initialized
    container.setAttribute('data-cta-initialized', 'true');
    
    // Try both ID and class selectors for title element
    const titleElement = container.querySelector('#rotating-cta-title, .cta-title');
    const subtitle = container.querySelector('.cta-pun-complaint');
    
    if (!titleElement || !subtitle) {
      console.log("[Initialize] CTA - Missing elements", { 
        titleElement: !!titleElement, 
        subtitle: !!subtitle,
        container: container.className 
      });
      return;
    }
    
    let currentIndex = 0;
    let clickCount = 0;
    
    function getNextTitle() {
      currentIndex = (currentIndex + 1) % CTA_TITLES.length;
      return CTA_TITLES[currentIndex];
    }

    // Set initial title if not already set
    if (!titleElement.dataset.initialized) {
      titleElement.textContent = CTA_TITLES[currentIndex];
      titleElement.dataset.initialized = "true";
    }

    subtitle.addEventListener('click', () => {
      titleElement.textContent = getNextTitle();
      clickCount++;
      
      if (clickCount === 1) {
        subtitle.textContent = "Click here to file another complaint.";
      } else if (clickCount === 2) {
        subtitle.textContent = "And another.";
      } else if (clickCount === 3) {
        subtitle.textContent = "Keep clicking.";
      } else if (clickCount === 4) {
        subtitle.textContent = "I promise this one will stop the puns.";
      } else if (clickCount === 5) {
        subtitle.textContent = "Fool me once, shame on me. Fool me twice... keep clicking.";
      } else if (clickCount === 6) {
        subtitle.textContent = "Insanity is doing the same thing over and over again and expecting different results.";
      } else if (clickCount >= 7) {
        subtitle.textContent = `Your measure of insanity: ${clickCount}`;
      }
    });
  });
}

// Initial run on DOM ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeAllCTAs);
} else {
  initializeAllCTAs();
}
