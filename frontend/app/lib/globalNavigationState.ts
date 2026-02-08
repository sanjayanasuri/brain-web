/**
 * Global navigation state management
 * Handles cross-component state like chat reset when navigating
 */

type ChatResetFunction = () => void;
type MobileSidebarCloseFunction = () => void;

interface GlobalNavigationState {
  chatResetFunction: ChatResetFunction | null;
  mobileSidebarCloseFunction: MobileSidebarCloseFunction | null;
}

// Global state (simple singleton pattern for this use case)
const globalNavigationState: GlobalNavigationState = {
  chatResetFunction: null,
  mobileSidebarCloseFunction: null
};

/**
 * Register chat reset function (called from GraphVisualization)
 */
export function registerChatResetFunction(resetFn: ChatResetFunction) {
  globalNavigationState.chatResetFunction = resetFn;
}

/**
 * Register mobile sidebar close function
 */
export function registerMobileSidebarCloseFunction(closeFn: MobileSidebarCloseFunction) {
  globalNavigationState.mobileSidebarCloseFunction = closeFn;
}

/**
 * Get current chat reset function
 */
export function getChatResetFunction(): ChatResetFunction | null {
  return globalNavigationState.chatResetFunction;
}

/**
 * Get current mobile sidebar close function
 */
export function getMobileSidebarCloseFunction(): MobileSidebarCloseFunction | null {
  return globalNavigationState.mobileSidebarCloseFunction;
}

/**
 * Clear chat state if available
 */
export function clearChatStateIfAvailable() {
  const resetFn = getChatResetFunction();
  if (resetFn) {
    console.log('Global Nav: Clearing chat state');
    resetFn();
  } else {
    console.log('Global Nav: No chat reset function available');
  }
}

/**
 * Close mobile sidebar if available
 */
export function closeMobileSidebarIfAvailable() {
  const closeFn = getMobileSidebarCloseFunction();
  if (closeFn) {
    console.log('Global Nav: Closing mobile sidebar');
    closeFn();
  }
}

/**
 * Clean up on component unmount
 */
export function unregisterNavigationFunctions() {
  console.log('Global Nav: Unregistering navigation functions');
  globalNavigationState.chatResetFunction = null;
  globalNavigationState.mobileSidebarCloseFunction = null;
}