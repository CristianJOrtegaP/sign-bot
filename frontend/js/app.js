/**
 * AC FIXBOT - Main Application
 */

/**
 * Initialize the application
 */
async function initApp() {
  console.log('AC FIXBOT Dashboard initializing...');

  // Initialize user authentication
  await window.Auth.initializeUser();

  // Load initial dashboard view
  window.Navigation.navigateTo('dashboard');

  console.log('AC FIXBOT Dashboard ready');
}

// Start the application when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
