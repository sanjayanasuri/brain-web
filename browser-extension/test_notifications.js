// Test script to check notification permissions
// Run this in the service worker console

async function testNotification() {
  try {
    console.log("Testing notification...");
    const iconUrl = chrome.runtime.getURL("assets/icon48.png");
    console.log("Icon URL:", iconUrl);
    
    const notificationId = await chrome.notifications.create({
      type: "basic",
      iconUrl: iconUrl,
      title: "Test Notification",
      message: "This is a test notification from Brain Web"
    });
    
    console.log("Notification created with ID:", notificationId);
    return notificationId;
  } catch (error) {
    console.error("Notification error:", error);
    return null;
  }
}

// Call it
testNotification();

