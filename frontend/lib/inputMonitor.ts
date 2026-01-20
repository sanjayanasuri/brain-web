/**
 * Input monitoring utility for tracking user interactions,
 * API response times, and detecting potentially malicious patterns.
 */

export interface InputEvent {
  type: 'keystroke' | 'click' | 'navigation';
  timestamp: number;
  value?: string;
  target?: string;
  metadata?: Record<string, any>;
}

/*
export interface InputEvent {
# this creates an interface type of InputEvent. 
# we want an interface. but not just one. 
# multiple interfaces. 
# InputEvent is one interface. 

# type is a PROPERTY of the INTERFACE. note there is no ? after type. 
# this is because it is a required property.
# type must be 'keystroke', 'click' and 'navigation'
# timestamp is another property of the interface. 
# timestamp stores when the event occured, usually Date.now()
# value? non-required property. used for keystroke values - "1", "2"
# change in LandingPage.tsx where const validation is defined. 
# metadata is a TypeScript utility type meaning an object with string keys and any values. 
# Record<string, any> takes in a string, or any.
# Record is an OBJECT. Objects can take parameters. 


}
*/

export interface ApiTiming {
  endpoint: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  success: boolean;
  error?: string;
}

class InputMonitor {
  private events: InputEvent[] = [];
  private apiTimings: ApiTiming[] = [];
  private maxEvents = 100; // Limit stored events to prevent memory issues

  /**
   * Track an input event (keystroke, click, navigation)
   */
  trackInput(event: Omit<InputEvent, 'timestamp'>): void {
    const fullEvent: InputEvent = {
      ...event,
      timestamp: Date.now(),
    };

    this.events.push(fullEvent);
    
    // Keep only the most recent events
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }

    // Log in dev mode
    if (process.env.NODE_ENV === 'development') {
      console.log('[InputMonitor]', fullEvent);
    }
  }

  /**
   * Start tracking an API call
   */
  startApiTiming(endpoint: string): string {
    const timing: ApiTiming = {
      endpoint,
      startTime: Date.now(),
      success: false,
    };

    this.apiTimings.push(timing);
    const timingId = (this.apiTimings.length - 1).toString();

    if (process.env.NODE_ENV === 'development') {
      console.log(`[InputMonitor] API call started: ${endpoint}`);
    }

    return timingId;
  }

  /**
   * Complete tracking an API call
   */
  completeApiTiming(timingId: string, success: boolean, error?: string): void {
    const index = parseInt(timingId, 10);
    if (index >= 0 && index < this.apiTimings.length) {
      const timing = this.apiTimings[index];
      timing.endTime = Date.now();
      timing.duration = timing.endTime - timing.startTime;
      timing.success = success;
      if (error) {
        timing.error = error;
      }

      if (process.env.NODE_ENV === 'development') {
        console.log(
          `[InputMonitor] API call completed: ${timing.endpoint} - ${timing.duration}ms - ${success ? 'success' : 'failed'}`
        );
      }
    }
  }

  /**
   * Detect potentially malicious input patterns
   */
  detectMaliciousPattern(input: string): {
    isMalicious: boolean;
    reasons: string[];
  } {
    const reasons: string[] = [];
    let isMalicious = false;

    // Check for XSS patterns
    const xssPatterns = [
      /<script/i,
      /javascript:/i,
      /on\w+\s*=/i,
      /<iframe/i,
      /<img[^>]+onerror/i,
    ];

    for (const pattern of xssPatterns) {
      if (pattern.test(input)) {
        reasons.push('Potential XSS attack detected');
        isMalicious = true;
        break;
      }
    }

    // Check for SQL injection patterns (if applicable)
    const sqlPatterns = [
      /('|(\\')|(;)|(\\)|(\/\*)|(\*\/)|(\-\-)|(\+)|(\%))/i,
      /(union|select|insert|update|delete|drop|create|alter|exec|execute)/i,
    ];

    for (const pattern of sqlPatterns) {
      if (pattern.test(input)) {
        reasons.push('Potential SQL injection detected');
        isMalicious = true;
        break;
      }
    }

    // Check for excessive length (potential DoS)
    if (input.length > 10000) {
      reasons.push('Input exceeds maximum length');
      isMalicious = true;
    }

    // Check for control characters
    if (/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/.test(input)) {
      reasons.push('Control characters detected');
      isMalicious = true;
    }

    return { isMalicious, reasons };
  }

  /**
   * Sanitize input to prevent XSS
   */
  sanitizeInput(input: string): string {
    return input
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
  }

  /**
   * Validate numeric input (for keystroke menu)
   */
  validateNumericInput(input: string, allowedValues: number[]): {
    isValid: boolean;
    value?: number;
    error?: string;
  } {
    const trimmed = input.trim();
    
    if (!trimmed) {
      return { isValid: false, error: 'Input is empty' };
    }

    const num = parseInt(trimmed, 10);
    
    if (isNaN(num)) {
      return { isValid: false, error: 'Input is not a number' };
    }

    if (!allowedValues.includes(num)) {
      return { isValid: false, error: `Input must be one of: ${allowedValues.join(', ')}` };
    }

    return { isValid: true, value: num };
  }

  /**
   * Get all tracked events
   */
  getEvents(): InputEvent[] {
    return [...this.events];
  }

  /**
   * Get all API timings
   */
  getApiTimings(): ApiTiming[] {
    return [...this.apiTimings];
  }

  /**
   * Clear all tracked data
   */
  clear(): void {
    this.events = [];
    this.apiTimings = [];
  }
}

// Export singleton instance
export const inputMonitor = new InputMonitor();
