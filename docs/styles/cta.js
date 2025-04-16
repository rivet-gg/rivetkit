// CTA titles array
const CTA_TITLES = [
  "Performance in every act - thanks to ActorCore.",
  "Scale without drama - only with ActorCore.",
  "It's time your backend took center-stage - with ActorCore.",
  "SQLite the spotlight on performance - with ActorCore.",
  "Backend scalability: the SQL - starring ActorCore.",
  "Take your state to the edge - ActorCore makes it easy.",
  "No state fright - just scalability with ActorCore.",
  "Act now, deploy at the edge - with ActorCore.",
  "Lights, camera, serverless - powered by ActorCore.",
  "Your backend deserves a standing ovation - ActorCore delivers.",
  "Cue your backend's best performance - enter ActorCore.",
  "Backend performance worth applauding - only with ActorCore.",
  "Put your backend center-stage - with ActorCore.",
  "Make your backend the main actor - with ActorCore.",
  "Give your backend its big break - use ActorCore.",
  "Serverless, with no intermissions - powered by ActorCore.",
  "Set the stage for serverless success - with ActorCore."
];

function initializeAllCTAs() {
  // Find CTA container
  document.querySelectorAll('.cta-container:not([data-cta-initialized])').forEach(container => {
    // Skip if already initialized
    if (container.hasAttribute('data-cta-initialized')) return;
    
    console.log("[Initialize] CTA", container?.id || "unnamed");
    
    // Mark as initialized
    container.setAttribute('data-cta-initialized', 'true');
    
    const titleElement = container.querySelector('#rotating-cta-title');
    const subtitle = container.querySelector('.cta-pun-complaint');
    
    if (!titleElement || !subtitle) return;
    
    let currentIndex = 0;
    let clickCount = 0;
    
    function getNextTitle() {
      currentIndex = (currentIndex + 1) % CTA_TITLES.length;
      return CTA_TITLES[currentIndex];
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