/**
 * SIGN BOT - Main Application
 */

/**
 * Initialize the application
 */
async function initApp() {
  console.log('Sign Bot Dashboard initializing...');

  // Initialize user authentication
  await window.Auth.initializeUser();

  // Load initial home view
  window.Navigation.navigateTo('home');

  console.log('Sign Bot Dashboard ready');
}

// Start the application when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
