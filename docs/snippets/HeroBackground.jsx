import React, { useEffect, useRef, useState } from "react";

export const HeroBackground = () => {
  // Configuration object for all particle behavior constants
  const PARTICLE_CONFIG = {
    // Particle appearance
    CIRCLE_RADIUS: 3,
    MAX_OPACITY: 0.05,
    ORANGE_COLOR: '#ff6b35', // Brighter orange

    // Grid layout
    GRID_SPACING: 40,

    // Mouse interaction
    PATH_FORCE_RADIUS: 200, // Radius for path-based forces
    BASE_PUSH_FORCE: 0.3,
    MOVEMENT_FORCE_MULTIPLIER: 4.0,
    MAX_MOUSE_VELOCITY: 5000,

    // Physics
    DAMPING: 0.975,
    SPRING_STRENGTH: 0.05,

    // Animation
    TARGET_FPS: 60,
    MAX_FRAME_TIME: 0.1, // seconds

    // Pulse effect
    PULSE_SPEED: 150, // pixels per second - faster wave
    PULSE_PEAK_OPACITY: 0.15, // less opaque
    PULSE_LOOP_INTERVAL: 8000, // milliseconds between pulses - less frequent
    PULSE_DURATION: 1500, // how long each pulse lasts at a particle
    
    // Intro pulse effect
    INTRO_PULSE_SPEED: 1200, // pixels per second - extremely fast
    
    // Click pulse effect
    CLICK_PULSE_SPEED: 1600, // pixels per second - 2x faster
    CLICK_PULSE_PEAK_OPACITY: 0.2, // slightly more visible than regular pulses
    CLICK_PULSE_DURATION: 800, // shorter duration for snappy effect

    // Debug
    DEBUG_MOUSE_TRACKING: false,
    DEBUG_DOT_RADIUS: 2,
    DEBUG_MAX_DOTS: 100,
  };

  // Simple Particle class for grid-based circles
  class Particle {
    constructor(x, y) {
      // Fixed position
      this.x = x;
      this.y = y;
      
      // Visual properties
      this.baseOpacity = 0; // Start at 0, will be set by intro pulse
      this.hasBeenRevealed = false; // Track if intro pulse has reached this particle
      
      // Pulse effect properties
      this.distanceFromCenter = 0;
      this.pulseOpacity = 0;
    }

    draw(ctx, config) {
      // Calculate total opacity: base + pulse
      let totalOpacity = this.baseOpacity + this.pulseOpacity;
      
      // Add subtle mouse proximity highlighting
      const mouseDistance = Math.sqrt((this.x - this.mouseX) ** 2 + (this.y - this.mouseY) ** 2);
      if (mouseDistance < config.PATH_FORCE_RADIUS) {
        const proximityFactor = 1 - (mouseDistance / config.PATH_FORCE_RADIUS);
        totalOpacity += proximityFactor * 0.07; // Slightly less intense highlight
      }
      
      if (totalOpacity <= 0) return;
      
      ctx.save();
      ctx.globalAlpha = Math.min(1, totalOpacity);
      ctx.fillStyle = 'white';
      ctx.beginPath();
      ctx.arc(this.x, this.y, config.CIRCLE_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    update(activePulses, mouseX, mouseY, config) {
      this.mouseX = mouseX;
      this.mouseY = mouseY;
      this.updatePulse(activePulses, config);
    }
    
    updatePulse(activePulses, config) {
      const currentTime = performance.now();
      this.pulseOpacity = 0;
      
      // Check all active pulses
      activePulses.forEach(pulse => {
        const timeSincePulseStart = currentTime - pulse.startTime;
        
        // Use different speed for different pulse types
        let pulseSpeed, pulseDuration, peakOpacity;
        if (pulse.isIntro) {
          pulseSpeed = config.INTRO_PULSE_SPEED;
          pulseDuration = config.PULSE_DURATION;
          peakOpacity = config.PULSE_PEAK_OPACITY;
        } else if (pulse.isClick) {
          pulseSpeed = config.CLICK_PULSE_SPEED;
          pulseDuration = config.CLICK_PULSE_DURATION;
          peakOpacity = config.CLICK_PULSE_PEAK_OPACITY;
        } else {
          pulseSpeed = config.PULSE_SPEED;
          pulseDuration = config.PULSE_DURATION;
          peakOpacity = config.PULSE_PEAK_OPACITY;
        }
        
        // Calculate when this pulse wave should reach this particle
        const waveRadius = (timeSincePulseStart / 1000) * pulseSpeed;
        
        // Calculate distance from this pulse's center (not always canvas center)
        const particleDistance = Math.sqrt((this.x - pulse.centerX) ** 2 + (this.y - pulse.centerY) ** 2);
        
        // Check if the wave has reached this particle
        if (waveRadius >= particleDistance) {
          // For intro pulse, permanently set base opacity when wave reaches particle
          if (pulse.isIntro && !this.hasBeenRevealed) {
            this.baseOpacity = config.MAX_OPACITY;
            this.hasBeenRevealed = true;
          }
          
          // Calculate how long the wave has been at this particle
          const timeAtParticle = timeSincePulseStart - (particleDistance / pulseSpeed * 1000);
          
          if (timeAtParticle >= 0 && timeAtParticle < pulseDuration) {
            const pulsePhase = timeAtParticle / pulseDuration;
            
            let pulseContribution = 0;
            
            if (pulse.isIntro) {
              // Intro pulse: starts at 0, peaks, then settles at base opacity
              if (pulsePhase < 0.3) {
                // Rising phase: 0 to peak
                const riseProgress = pulsePhase / 0.3;
                pulseContribution = riseProgress * peakOpacity;
              } else {
                // Falling phase: peak to 0 (base opacity already set above)
                const fallProgress = (pulsePhase - 0.3) / 0.7;
                pulseContribution = peakOpacity * (1 - fallProgress);
              }
            } else {
              // Regular and click pulses: normal pulse behavior
              if (pulsePhase < 0.3) {
                // Rising phase: 0 to peak
                pulseContribution = (pulsePhase / 0.3) * peakOpacity;
              } else if (pulsePhase < 1) {
                // Falling phase: peak to 0
                const fallProgress = (pulsePhase - 0.3) / 0.7;
                pulseContribution = peakOpacity * (1 - fallProgress);
              }
            }
            
            // Add this pulse's contribution (multiple pulses can stack)
            this.pulseOpacity += pulseContribution;
          }
        }
      });
      
      // Clamp to maximum opacity
      this.pulseOpacity = Math.min(this.pulseOpacity, config.PULSE_PEAK_OPACITY * 2);
    }
  }

  const canvasRef = useRef(null);
  const wrapperRef = useRef(null);
  const [particles, setParticles] = useState([]);
  const [activePulses, setActivePulses] = useState([]);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [systemStartTime, setSystemStartTime] = useState(0);
  const [isVisible, setIsVisible] = useState(window.innerWidth >= 750);
  const animationFrameRef = useRef(null);
  const lastFrameTimeRef = useRef(0);

  // Initialize the particle system
  useEffect(() => {
    
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;

    // Get landing-root element for positioning 
    const landingRoot = document.querySelector('.landing-root');
    const landingHero = document.querySelector('.landing-hero');
    
    // Calculate positioning based on landing-root
    let leftPadding = 56; // Default desktop padding
    let rightPadding = 56;
    let containerHeight = window.innerHeight; // Default to viewport height
    
    if (landingRoot) {
      const rootStyles = window.getComputedStyle(landingRoot);
      leftPadding = parseInt(rootStyles.paddingLeft) || 56;
      rightPadding = parseInt(rootStyles.paddingRight) || 56;
    }
    
    if (landingHero) {
      containerHeight = landingHero.offsetHeight;
    }

    // Set canvas size to match wrapper dimensions
    canvas.width = window.innerWidth - leftPadding - rightPadding;
    canvas.height = containerHeight;

    // Create grid-based particles
    const newParticles = createGridParticles(canvas, leftPadding, rightPadding);
    setParticles(newParticles);

    // Initialize timing
    const startTime = performance.now();
    setSystemStartTime(startTime);

    // Add immediate intro pulse that moves very fast
    setActivePulses([{
      startTime: startTime,
      centerX: canvas.width / 2,
      centerY: canvas.height / 2,
      isIntro: true // Mark as intro pulse for different speed
    }]);

    // Initialize mouse position to center of canvas
    setMousePosition({ x: canvas.width / 2, y: canvas.height / 2 });

    lastFrameTimeRef.current = startTime;

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  // Create particles in a grid layout
  const createGridParticles = (canvas, leftPadding, rightPadding) => {
    if (!canvas) return [];
    
    const newParticles = [];
    const baseSpacing = PARTICLE_CONFIG.GRID_SPACING;
    const edgeMargin = 40; // Constant distance from edges
    
    // Get exclusion zones from landing-hero direct children
    const exclusionZones = getExclusionZones(wrapperRef.current);
    
    // Calculate available space after accounting for edge margins
    const availableWidth = canvas.width - (2 * edgeMargin);
    const availableHeight = canvas.height - (2 * edgeMargin);
    
    // Calculate maximum number of particles that fit with base spacing
    const maxCols = Math.floor(availableWidth / baseSpacing);
    const maxRows = Math.floor(availableHeight / baseSpacing);
    
    // Adjust spacing to distribute particles evenly with exact edge margins
    const actualSpacingX = maxCols > 0 ? availableWidth / maxCols : baseSpacing;
    const actualSpacingY = maxRows > 0 ? availableHeight / maxRows : baseSpacing;
    
    // Calculate center for opacity calculations
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    
    for (let row = 0; row <= maxRows; row++) {
      for (let col = 0; col <= maxCols; col++) {
        const x = edgeMargin + col * actualSpacingX;
        const y = edgeMargin + row * actualSpacingY;
        
        // Skip if particle overlaps with any exclusion zone
        if (isPointInExclusionZones(x, y, exclusionZones)) continue;
        
        const particle = new Particle(x, y);
        
        // Calculate distance from center for pulse effect
        particle.distanceFromCenter = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
        
        // Start with zero opacity - intro pulse will reveal them
        particle.baseOpacity = 0;
        
        newParticles.push(particle);
      }
    }

    return newParticles;
  };

  // Get bounding rectangles of specific landing page elements
  const getExclusionZones = (wrapper) => {
    if (!wrapper) return [];
    
    const wrapperRect = wrapper.getBoundingClientRect();
    const exclusionZones = [];
    const margin = 25; // 25px margin around bounding boxes
    
    // Specific selectors to avoid overlap with
    const selectors = [
      '.landing-title',
      '.landing-subtitle', 
      '.libraries-grid',
      '.landing-buttons',
      '.platform-icons-label',
      '.platform-icons-row'
    ];
    
    selectors.forEach(selector => {
      const element = document.querySelector(selector);
      if (!element) return;
      
      const rect = element.getBoundingClientRect();
      
      // Convert to canvas coordinates (relative to wrapper) and add margin
      const canvasRect = {
        left: rect.left - wrapperRect.left - margin,
        top: rect.top - wrapperRect.top - margin,
        right: rect.right - wrapperRect.left + margin,
        bottom: rect.bottom - wrapperRect.top + margin
      };
      
      // Only add if the rect intersects with canvas bounds
      const canvas = canvasRef.current;
      if (canvas && canvasRect.right > 0 && canvasRect.left < canvas.width &&
          canvasRect.bottom > 0 && canvasRect.top < canvas.height) {
        exclusionZones.push(canvasRect);
      }
    });
    
    return exclusionZones;
  };

  // Check if a point (with circle radius) overlaps with any exclusion zone
  const isPointInExclusionZones = (x, y, exclusionZones) => {
    const radius = PARTICLE_CONFIG.CIRCLE_RADIUS;
    
    for (const zone of exclusionZones) {
      // Check if circle centered at (x, y) with given radius overlaps with rectangle
      const closestX = Math.max(zone.left, Math.min(x, zone.right));
      const closestY = Math.max(zone.top, Math.min(y, zone.bottom));
      
      const distanceX = x - closestX;
      const distanceY = y - closestY;
      const distanceSq = distanceX * distanceX + distanceY * distanceY;
      
      if (distanceSq <= radius * radius) {
        return true;
      }
    }
    
    return false;
  };

  // Manage pulse creation and cleanup
  const managePulses = (currentTime) => {
    const timeSinceSystemStart = currentTime - systemStartTime;
    
    // Calculate how many regular pulses we should have (excluding the intro pulse)
    // Start regular pulses after a delay to let the intro pulse finish
    const regularPulseStartDelay = 2000; // 2 seconds after system start
    if (timeSinceSystemStart < regularPulseStartDelay) {
      return;
    }
    
    const adjustedTime = timeSinceSystemStart - regularPulseStartDelay;
    const shouldHaveRegularPulseCount = Math.floor(adjustedTime / PARTICLE_CONFIG.PULSE_LOOP_INTERVAL) + 1;
    const currentRegularPulseCount = activePulses.filter(p => !p.isIntro).length;
    
    // Create new regular pulses if needed
    if (currentRegularPulseCount < shouldHaveRegularPulseCount) {
      const regularPulseIndex = currentRegularPulseCount;
      const pulseStartTime = systemStartTime + regularPulseStartDelay + (regularPulseIndex * PARTICLE_CONFIG.PULSE_LOOP_INTERVAL);
      
      const canvas = canvasRef.current;
      setActivePulses(prev => [...prev, {
        startTime: pulseStartTime,
        centerX: canvas ? canvas.width / 2 : 0,
        centerY: canvas ? canvas.height / 2 : 0,
        isIntro: false
      }]);
    }
    
    // Clean up pulses that are too old (beyond their effective range)
    const canvas = canvasRef.current;
    const maxCanvasDiagonal = canvas ? Math.sqrt(canvas.width ** 2 + canvas.height ** 2) : 1000;
    
    setActivePulses(prev => prev.filter(pulse => {
      let pulseSpeed, pulseDuration;
      if (pulse.isIntro) {
        pulseSpeed = PARTICLE_CONFIG.INTRO_PULSE_SPEED;
        pulseDuration = PARTICLE_CONFIG.PULSE_DURATION;
      } else if (pulse.isClick) {
        pulseSpeed = PARTICLE_CONFIG.CLICK_PULSE_SPEED;
        pulseDuration = PARTICLE_CONFIG.CLICK_PULSE_DURATION;
      } else {
        pulseSpeed = PARTICLE_CONFIG.PULSE_SPEED;
        pulseDuration = PARTICLE_CONFIG.PULSE_DURATION;
      }
      
      const maxPulseLifetime = (maxCanvasDiagonal / pulseSpeed * 1000) + pulseDuration;
      return (currentTime - pulse.startTime) < maxPulseLifetime;
    }));
  };

  // Animation loop
  useEffect(() => {
    
    const TARGET_FPS = PARTICLE_CONFIG.TARGET_FPS;
    const FRAME_TIME = 1000 / TARGET_FPS;

    const animate = () => {
      const currentTime = performance.now();
      const timeSinceLastFrame = currentTime - lastFrameTimeRef.current;

      // Only render if enough time has passed for next frame
      if (timeSinceLastFrame >= FRAME_TIME) {
        lastFrameTimeRef.current = currentTime;

        // Manage pulse creation and cleanup
        managePulses(currentTime);
        
        // Update particles
        particles.forEach(particle => {
          particle.update(activePulses, mousePosition.x, mousePosition.y, PARTICLE_CONFIG);
        });

        // Draw particles
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (canvas && ctx) {
          // Clear canvas
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          // Draw particles
          particles.forEach(particle => {
            particle.draw(ctx, PARTICLE_CONFIG);
          });
        }
      }

      // Continue animation
      animationFrameRef.current = requestAnimationFrame(animate);
    };

    if (particles.length > 0) {
      animationFrameRef.current = requestAnimationFrame(animate);
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [particles, activePulses, mousePosition, systemStartTime]);

  // Handle mouse movement
  const handleMouseMove = (e) => {
    if (wrapperRef.current) {
      const wrapperRect = wrapperRef.current.getBoundingClientRect();
      setMousePosition({
        x: e.clientX - wrapperRect.left,
        y: e.clientY - wrapperRect.top
      });
    }
  };

  // Handle mouse clicks to create pulses
  const handleMouseDown = (e) => {
    let clickX, clickY;
    if (wrapperRef.current) {
      const wrapperRect = wrapperRef.current.getBoundingClientRect();
      clickX = e.clientX - wrapperRect.left;
      clickY = e.clientY - wrapperRect.top;
    } else {
      clickX = e.pageX;
      clickY = e.pageY;
    }
    
    // Create a new click pulse at the mousedown position
    setActivePulses(prev => [...prev, {
      startTime: performance.now(),
      centerX: clickX,
      centerY: clickY,
      isClick: true // Mark as click pulse for different behavior
    }]);
  };

  // Set up global mouse event listeners
  useEffect(() => {
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mousedown', handleMouseDown);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, []);

  // Handle resize
  useEffect(() => {
    
    const handleResize = () => {
      const canvas = canvasRef.current;
      const wrapper = wrapperRef.current;
      
      // Update visibility based on window width
      setIsVisible(window.innerWidth >= 750);
      
      if (!canvas || !wrapper) return;

      // Recalculate dimensions
      const landingRoot = document.querySelector('.landing-root');
      const landingHero = document.querySelector('.landing-hero');
      const rootRect = landingRoot?.getBoundingClientRect();
      const heroRect = landingHero?.getBoundingClientRect();
      
      if (rootRect && heroRect) {
        const canvasWidth = rootRect.width;
        const canvasHeight = heroRect.height;

        // Update canvas size
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;

        // Recreate grid particles for new dimensions
        const newParticles = createGridParticles(canvas, rootRect.left, window.innerWidth - rootRect.right);
        setParticles(newParticles);
      }
    };

    window.addEventListener('resize', handleResize);
    // Wait for layout to finish and re-render
    setTimeout(handleResize, 0);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return (
    <div 
      ref={wrapperRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100vh',
        overflow: 'hidden',
        pointerEvents: 'none',
        zIndex: -1,
        display: isVisible ? 'block' : 'none'
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: -1
        }}
      />
    </div>
  );
}
