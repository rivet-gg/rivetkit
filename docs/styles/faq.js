function initializeFAQ(faqSection) {
    console.log("[Initialize] FAQ", faqSection?.id || "all");
    
    // If no section provided, fall back to querying all accordions
    const accordions = faqSection ? 
        faqSection.querySelectorAll('.faq-accordion') : 
        document.querySelectorAll('.faq-accordion');
        
    if (!accordions.length) return;
    
    accordions.forEach(accordion => {
        const button = accordion.querySelector('.faq-question');
        const answer = accordion.querySelector('.faq-answer');
        
        if (!button || !answer) return;
        
        button.addEventListener('click', () => {
            const isOpen = accordion.getAttribute('data-state') === 'open';
            
            // Close all other accordions
            accordions.forEach(otherAccordion => {
                if (otherAccordion !== accordion) {
                    otherAccordion.setAttribute('data-state', 'closed');
                }
            });
            
            // Toggle current accordion
            accordion.setAttribute('data-state', isOpen ? 'closed' : 'open');
        });
    });
}

// Create an observer instance
const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
        if (mutation.type !== 'childList') continue;
        
        for (const node of mutation.addedNodes) {
            console.log('Observed', node);
            // Quick check for element nodes only
            if (node.nodeType !== 1) continue;
            
            // Direct class check is faster than matches()
            if (node.classList?.contains('faq-section')) {
                initializeFAQ(node);
                continue;
            }
            
            // Only query children if needed
            const nestedSection = node.getElementsByClassName('faq-section')[0];
            if (nestedSection) {
                initializeFAQ(nestedSection);
                continue;
            }
        }
    }
});

// Start observing with optimized configuration
observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: false,
    characterData: false
});

// Initialize any existing FAQ sections
document.querySelectorAll('.faq-section').forEach(section => initializeFAQ(section));

// Cleanup when needed
function cleanup() {
    observer.disconnect();
}

// Optional: Add cleanup on page unload
window.addEventListener('unload', cleanup); 