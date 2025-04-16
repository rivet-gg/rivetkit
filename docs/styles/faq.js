function initializeFAQ() {
    // Find all FAQ sections
    document.querySelectorAll('.faq-section').forEach(faqSection => {
        // Skip if already initialized
        if (faqSection.hasAttribute('data-faq-initialized')) return;
        
        console.log("[Initialize] FAQ", faqSection?.id || "all");
        
        // Mark as initialized
        faqSection.setAttribute('data-faq-initialized', 'true');
        
        // Find all accordions in this section
        const accordions = faqSection.querySelectorAll('.faq-accordion');
        if (!accordions.length) return;
        
        accordions.forEach(accordion => {
            // Skip if already initialized
            if (accordion.hasAttribute('data-initialized')) return;
            
            const button = accordion.querySelector('.faq-question');
            const answer = accordion.querySelector('.faq-answer');
            
            if (!button || !answer) return;
            
            // Mark as initialized to prevent duplicate listeners
            accordion.setAttribute('data-initialized', 'true');
            
            button.addEventListener('click', () => {
                const isOpen = accordion.getAttribute('data-state') === 'open';
                
                // Close all other accordions in this section
                accordions.forEach(otherAccordion => {
                    if (otherAccordion !== accordion) {
                        otherAccordion.setAttribute('data-state', 'closed');
                    }
                });
                
                // Toggle current accordion
                accordion.setAttribute('data-state', isOpen ? 'closed' : 'open');
            });
        });
    });
}

// Initial run on DOM ready
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeFAQ);
} else {
    initializeFAQ();
}