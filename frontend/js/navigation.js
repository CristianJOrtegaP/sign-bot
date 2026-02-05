/**
 * AC FIXBOT - Navigation
 */

let currentSection = 'dashboard';
let autoRefreshKpis = null;
let autoRefreshList = null;

/**
 * Navigate to a section (dashboard or conversations)
 */
function navigateTo(section) {
  currentSection = section;

  // Update nav items
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.section === section);
  });

  // Show/hide sections
  const dashboardView = document.getElementById('dashboardView');
  const conversationsView = document.getElementById('conversationsView');

  if (dashboardView) {
    dashboardView.classList.toggle('section-hidden', section !== 'dashboard');
  }
  if (conversationsView) {
    conversationsView.classList.toggle('section-hidden', section !== 'conversations');
  }

  // Clear previous intervals
  if (autoRefreshKpis) {
    clearInterval(autoRefreshKpis);
  }
  if (autoRefreshList) {
    clearInterval(autoRefreshList);
  }

  // Load data for section
  if (section === 'dashboard') {
    window.Dashboard.loadKPIs();
    autoRefreshKpis = setInterval(window.Dashboard.loadKPIs, window.CONFIG.REFRESH_INTERVAL_KPIS);
  } else if (section === 'conversations') {
    window.Conversations.loadList();
    autoRefreshList = setInterval(
      window.Conversations.loadList,
      window.CONFIG.REFRESH_INTERVAL_CONVERSATIONS
    );
  }
}

/**
 * Show sidebar (mobile)
 */
function showSidebar() {
  const sidebar = document.getElementById('sidebar');
  const chatArea = document.getElementById('chatArea');
  if (sidebar) {
    sidebar.classList.remove('hidden');
  }
  if (chatArea) {
    chatArea.classList.remove('active');
  }
}

/**
 * Get current section
 */
function getCurrentSection() {
  return currentSection;
}

// Export for use in other modules
window.Navigation = {
  navigateTo,
  showSidebar,
  getCurrentSection,
};
