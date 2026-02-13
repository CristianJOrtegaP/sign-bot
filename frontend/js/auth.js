/**
 * SIGN BOT - Authentication & User Management
 */

// User state
let agentId = `admin_${Math.random().toString(36).substr(2, 9)}`;
let agentName = 'Admin';
let agentEmail = '';

/**
 * Initialize user from Azure Easy Auth
 * In SWA, user info is available via /.auth/me endpoint
 */
async function initializeUser() {
  try {
    const response = await fetch('/.auth/me');
    const data = await response.json();

    if (data.clientPrincipal) {
      const principal = data.clientPrincipal;

      // Get user details from claims
      if (principal.userDetails) {
        agentName = principal.userDetails;
        if (principal.userDetails.indexOf('@') > -1) {
          agentEmail = principal.userDetails;
          agentName = principal.userDetails.split('@')[0].replace(/[._-]/g, ' ');
        }
      }

      // Look for name in claims
      if (principal.claims) {
        const nameClaim = principal.claims.find(
          (c) =>
            c.typ === 'name' ||
            c.typ === 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'
        );
        if (nameClaim && nameClaim.val) {
          agentName = nameClaim.val;
        }

        const emailClaim = principal.claims.find(
          (c) =>
            c.typ === 'email' ||
            c.typ === 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress' ||
            c.typ === 'preferred_username'
        );
        if (emailClaim && emailClaim.val) {
          agentEmail = emailClaim.val;
        }
      }

      // Generate stable agent ID from email
      if (agentEmail) {
        agentId = `admin_${agentEmail.replace(/[^a-zA-Z0-9]/g, '_')}`;
      }
    }
  } catch (error) {
    console.log('Easy Auth not available, using default user');
  }

  // No loguear email en consola (seguridad: evita exposicion de PII)
  updateUserUI();
}

/**
 * Update UI elements with user info
 */
function updateUserUI() {
  const initials =
    agentName
      .split(' ')
      .map((w) => w.charAt(0).toUpperCase())
      .slice(0, 2)
      .join('') || agentName.charAt(0).toUpperCase();

  // Update nav user
  const navUserName = document.getElementById('navUserName');
  const navUserAvatar = document.getElementById('navUserAvatar');
  if (navUserName) {
    navUserName.textContent = agentName;
  }
  if (navUserAvatar) {
    navUserAvatar.textContent = initials;
  }

  // Update sidebar user (conversations view)
  const userName = document.getElementById('userName');
  const userAvatar = document.getElementById('userAvatar');
  const userRole = document.getElementById('userRole');
  if (userName) {
    userName.textContent = agentName;
  }
  if (userAvatar) {
    userAvatar.innerHTML = `${initials}<div class="online-dot"></div>`;
  }
  if (userRole) {
    userRole.textContent = agentEmail || 'Administrador';
  }
}

/**
 * Get current agent info
 */
function getAgentInfo() {
  return {
    id: agentId,
    name: agentName,
    email: agentEmail,
  };
}

// Export for use in other modules
window.Auth = {
  initializeUser,
  updateUserUI,
  getAgentInfo,
};
