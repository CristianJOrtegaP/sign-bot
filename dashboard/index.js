/**
 * AC FIXBOT - Dashboard de Conversaciones (Protegido con Azure AD)
 * Diseño moderno 2026 con glassmorphism y efectos visuales
 */

/**
 * Genera el HTML del dashboard con diseño moderno 2026
 */
function getDashboardHTML(userName, userEmail) {
  userName = userName || 'Agente';
  userEmail = userEmail || '';
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AC FIXBOT - Dashboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --arca-red: #E31837;
      --arca-red-light: #FF4D6A;
      --arca-red-dark: #B81430;
      --arca-gradient: linear-gradient(135deg, #FF4D6A 0%, #E31837 50%, #B81430 100%);
      --glass-bg: rgba(255, 255, 255, 0.7);
      --glass-border: rgba(255, 255, 255, 0.4);
      --glass-shadow: 0 8px 32px rgba(0, 0, 0, 0.08);
      --text-primary: #0F172A;
      --text-secondary: #64748B;
      --text-muted: #94A3B8;
      --surface: #FFFFFF;
      --surface-hover: #F8FAFC;
      --accent-green: #10B981;
      --accent-blue: #3B82F6;
      --accent-purple: #8B5CF6;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background: linear-gradient(135deg, #FDF2F4 0%, #F1F5F9 50%, #EDE9FE 100%);
      background-attachment: fixed;
      color: var(--text-primary);
      height: 100vh;
      display: flex;
      overflow: hidden;
    }
    body::before {
      content: '';
      position: fixed;
      top: -50%;
      right: -50%;
      width: 100%;
      height: 100%;
      background: radial-gradient(circle, rgba(227,24,55,0.08) 0%, transparent 50%);
      pointer-events: none;
    }
    .sidebar {
      width: 400px;
      background: var(--glass-bg);
      backdrop-filter: blur(24px);
      -webkit-backdrop-filter: blur(24px);
      border-right: 1px solid var(--glass-border);
      display: flex;
      flex-direction: column;
      box-shadow: var(--glass-shadow);
      position: relative;
      z-index: 10;
    }
    .sidebar-header {
      padding: 24px;
      background: var(--arca-gradient);
      color: white;
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: relative;
      overflow: hidden;
    }
    .sidebar-header::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.08'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E");
      opacity: 0.5;
    }
    .sidebar-header h1 {
      font-size: 20px;
      font-weight: 800;
      display: flex;
      align-items: center;
      gap: 14px;
      position: relative;
      letter-spacing: -0.5px;
    }
    .logo-icon {
      width: 42px;
      height: 42px;
      background: white;
      border-radius: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 22px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }
    .user-info {
      padding: 20px 24px;
      background: linear-gradient(180deg, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0.6) 100%);
      border-bottom: 1px solid rgba(0,0,0,0.04);
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .user-avatar {
      width: 52px;
      height: 52px;
      background: var(--arca-gradient);
      border-radius: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: 800;
      font-size: 20px;
      position: relative;
      box-shadow: 0 4px 16px rgba(227,24,55,0.3);
    }
    .online-dot {
      width: 14px;
      height: 14px;
      background: var(--accent-green);
      border-radius: 50%;
      border: 3px solid white;
      position: absolute;
      bottom: -3px;
      right: -3px;
      box-shadow: 0 2px 8px rgba(16,185,129,0.4);
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.1); opacity: 0.8; }
    }
    .user-details { flex: 1; }
    .user-name { font-weight: 700; font-size: 16px; color: var(--text-primary); }
    .user-role { font-size: 13px; color: var(--text-secondary); margin-top: 3px; }
    .search-box { padding: 16px 20px; }
    .search-box input {
      width: 100%;
      padding: 16px 20px;
      background: white;
      border: 2px solid transparent;
      border-radius: 16px;
      font-size: 14px;
      font-weight: 500;
      box-shadow: 0 2px 12px rgba(0,0,0,0.04);
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .search-box input:focus {
      outline: none;
      border-color: var(--arca-red);
      box-shadow: 0 0 0 4px rgba(227,24,55,0.1), 0 4px 20px rgba(227,24,55,0.15);
      transform: translateY(-1px);
    }
    .search-box input::placeholder { color: var(--text-muted); }
    .conversations { flex: 1; overflow-y: auto; padding: 12px 16px; }
    .conversations::-webkit-scrollbar { width: 6px; }
    .conversations::-webkit-scrollbar-track { background: transparent; }
    .conversations::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.1); border-radius: 3px; }
    .conversation-item {
      padding: 16px 18px;
      display: flex;
      align-items: center;
      gap: 16px;
      cursor: pointer;
      border-radius: 20px;
      margin-bottom: 8px;
      background: white;
      border: 2px solid transparent;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 2px 8px rgba(0,0,0,0.02);
    }
    .conversation-item:hover {
      background: var(--surface-hover);
      transform: translateX(6px) scale(1.01);
      box-shadow: 0 8px 24px rgba(0,0,0,0.08);
      border-color: rgba(227,24,55,0.1);
    }
    .conversation-item.active {
      background: linear-gradient(135deg, rgba(227,24,55,0.08) 0%, rgba(255,77,106,0.04) 100%);
      border-color: var(--arca-red);
      box-shadow: 0 4px 20px rgba(227,24,55,0.15);
    }
    .avatar {
      width: 54px;
      height: 54px;
      background: var(--arca-gradient);
      border-radius: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      font-weight: 800;
      color: white;
      box-shadow: 0 4px 12px rgba(227,24,55,0.25);
      flex-shrink: 0;
    }
    .avatar.agent {
      background: linear-gradient(135deg, #60A5FA 0%, #3B82F6 50%, #1D4ED8 100%);
      box-shadow: 0 4px 12px rgba(59,130,246,0.25);
    }
    .conv-info { flex: 1; min-width: 0; }
    .conv-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
    .conv-name { font-size: 15px; font-weight: 700; color: var(--text-primary); }
    .conv-time { font-size: 12px; color: var(--text-muted); font-weight: 500; }
    .conv-preview { font-size: 13px; color: var(--text-secondary); display: flex; align-items: center; gap: 10px; }
    .status {
      font-size: 10px;
      padding: 5px 12px;
      border-radius: 20px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .status.activo { background: linear-gradient(135deg, #D1FAE5 0%, #A7F3D0 100%); color: #047857; }
    .status.agente { background: linear-gradient(135deg, #DBEAFE 0%, #BFDBFE 100%); color: #1D4ED8; }
    .status.finalizado { background: linear-gradient(135deg, #F1F5F9 0%, #E2E8F0 100%); color: #475569; }
    .chat-area {
      flex: 1;
      display: flex;
      flex-direction: column;
      background: linear-gradient(180deg, #FAFBFC 0%, #F1F5F9 100%);
      position: relative;
    }
    .chat-header {
      padding: 20px 28px;
      background: var(--glass-bg);
      backdrop-filter: blur(20px);
      display: flex;
      align-items: center;
      gap: 18px;
      border-bottom: 1px solid var(--glass-border);
      box-shadow: 0 4px 20px rgba(0,0,0,0.03);
    }
    .chat-header .avatar { width: 50px; height: 50px; font-size: 19px; }
    .chat-header-info { flex: 1; }
    .chat-header-info h2 { font-size: 18px; font-weight: 800; letter-spacing: -0.3px; }
    .chat-header-info span { font-size: 13px; color: var(--text-secondary); font-weight: 500; }
    .chat-header-actions { display: flex; gap: 10px; }
    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 28px 36px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .messages::-webkit-scrollbar { width: 6px; }
    .messages::-webkit-scrollbar-track { background: transparent; }
    .messages::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.1); border-radius: 3px; }
    .message { max-width: 72%; display: flex; flex-direction: column; animation: fadeIn 0.3s ease; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    .message.user { align-self: flex-start; }
    .message.bot, .message.agent { align-self: flex-end; }
    .message-content {
      padding: 16px 20px;
      border-radius: 24px;
      font-size: 14px;
      line-height: 1.7;
      box-shadow: 0 2px 12px rgba(0,0,0,0.06);
    }
    .message.user .message-content {
      background: white;
      border: 1px solid rgba(0,0,0,0.06);
      border-bottom-left-radius: 8px;
      color: var(--text-primary);
    }
    .message.bot .message-content {
      background: var(--arca-gradient);
      color: white;
      border-bottom-right-radius: 8px;
      box-shadow: 0 4px 20px rgba(227,24,55,0.25);
    }
    .message.agent .message-content {
      background: linear-gradient(135deg, #60A5FA 0%, #3B82F6 50%, #1D4ED8 100%);
      color: white;
      border-bottom-right-radius: 8px;
      box-shadow: 0 4px 20px rgba(59,130,246,0.25);
    }
    .message-time { font-size: 11px; color: var(--text-muted); margin-top: 8px; padding: 0 8px; font-weight: 500; }
    .message.bot .message-time, .message.agent .message-time { text-align: right; }
    .message-sender { font-size: 11px; font-weight: 700; margin-bottom: 8px; padding: 0 8px; text-transform: uppercase; letter-spacing: 0.5px; }
    .message.user .message-sender { color: var(--text-secondary); }
    .message.bot .message-sender { color: var(--arca-red); text-align: right; }
    .message.agent .message-sender { color: var(--accent-blue); text-align: right; }
    .msg-image { max-width: 300px; max-height: 300px; border-radius: 16px; cursor: pointer; margin: 10px 0; box-shadow: 0 4px 16px rgba(0,0,0,0.1); transition: transform 0.2s; }
    .msg-image:hover { transform: scale(1.02); }
    .date-separator { text-align: center; margin: 28px 0; }
    .date-separator span {
      background: white;
      padding: 12px 24px;
      border-radius: 24px;
      font-size: 12px;
      color: var(--text-secondary);
      font-weight: 600;
      box-shadow: 0 2px 12px rgba(0,0,0,0.04);
      letter-spacing: 0.3px;
    }
    .empty-state {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 48px;
    }
    .empty-state-icon {
      width: 120px;
      height: 120px;
      background: var(--arca-gradient);
      border-radius: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 32px;
      box-shadow: 0 12px 40px rgba(227,24,55,0.25);
      animation: float 3s ease-in-out infinite;
    }
    @keyframes float {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-10px); }
    }
    .empty-state-icon svg { width: 56px; height: 56px; fill: white; }
    .empty-state h2 { font-size: 32px; font-weight: 800; margin-bottom: 16px; color: var(--text-primary); letter-spacing: -0.5px; }
    .empty-state p { font-size: 16px; text-align: center; max-width: 440px; line-height: 1.8; color: var(--text-secondary); }
    .loading { text-align: center; padding: 56px 28px; color: var(--text-secondary); }
    .loading-spinner {
      width: 48px;
      height: 48px;
      border: 4px solid rgba(227,24,55,0.1);
      border-top-color: var(--arca-red);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin: 0 auto 20px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .btn {
      padding: 14px 28px;
      border: none;
      border-radius: 16px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 700;
      display: inline-flex;
      align-items: center;
      gap: 10px;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      letter-spacing: -0.2px;
    }
    .btn-primary {
      background: var(--arca-gradient);
      color: white;
      box-shadow: 0 6px 24px rgba(227,24,55,0.35);
    }
    .btn-primary:hover { transform: translateY(-3px) scale(1.02); box-shadow: 0 12px 32px rgba(227,24,55,0.4); }
    .btn-danger {
      background: linear-gradient(135deg, #FEE2E2 0%, #FECACA 100%);
      color: #DC2626;
      box-shadow: 0 4px 16px rgba(220,38,38,0.15);
    }
    .btn-danger:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(220,38,38,0.2); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none !important; }
    .input-area {
      padding: 24px 28px;
      background: var(--glass-bg);
      backdrop-filter: blur(20px);
      display: flex;
      gap: 16px;
      align-items: center;
      border-top: 1px solid var(--glass-border);
    }
    .input-area input {
      flex: 1;
      padding: 18px 24px;
      background: white;
      border: 2px solid transparent;
      border-radius: 20px;
      font-size: 15px;
      font-weight: 500;
      box-shadow: 0 2px 12px rgba(0,0,0,0.04);
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .input-area input:focus {
      outline: none;
      border-color: var(--arca-red);
      box-shadow: 0 0 0 4px rgba(227,24,55,0.1), 0 4px 20px rgba(227,24,55,0.1);
    }
    .input-area input:disabled { opacity: 0.5; background: #F8FAFC; }
    .input-area input::placeholder { color: var(--text-muted); }
    .send-btn {
      width: 58px;
      height: 58px;
      background: var(--arca-gradient);
      border: none;
      border-radius: 20px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 6px 24px rgba(227,24,55,0.35);
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .send-btn:hover { transform: scale(1.08) rotate(5deg); box-shadow: 0 10px 32px rgba(227,24,55,0.4); }
    .send-btn:disabled { background: linear-gradient(135deg, #CBD5E1 0%, #94A3B8 100%); cursor: not-allowed; box-shadow: none; transform: none; }
    .send-btn svg { fill: white; width: 24px; height: 24px; }
    .agent-banner {
      padding: 16px 28px;
      background: linear-gradient(135deg, #60A5FA 0%, #3B82F6 50%, #1D4ED8 100%);
      color: white;
      font-size: 13px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-weight: 600;
      box-shadow: 0 4px 16px rgba(59,130,246,0.25);
    }
    .refresh-btn {
      background: rgba(255,255,255,0.2);
      border: 1px solid rgba(255,255,255,0.3);
      color: white;
      cursor: pointer;
      padding: 12px;
      border-radius: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.3s ease;
      backdrop-filter: blur(8px);
    }
    .refresh-btn:hover { background: rgba(255,255,255,0.3); transform: rotate(180deg); }
    .refresh-btn.spinning svg { animation: spin 0.8s linear infinite; }
    @media (max-width: 768px) {
      .sidebar { width: 100%; position: absolute; left: 0; z-index: 10; transition: transform 0.3s ease; }
      .sidebar.hidden { transform: translateX(-100%); }
      .chat-area { display: none; }
      .chat-area.active { display: flex; position: absolute; width: 100%; z-index: 20; }
      .back-btn { display: block !important; }
      .messages { padding: 20px 16px; }
    }
    .back-btn { display: none; background: none; border: none; color: var(--text-secondary); cursor: pointer; padding: 10px; border-radius: 12px; transition: all 0.2s; }
    .back-btn:hover { background: rgba(0,0,0,0.05); }

    /* ==================== NAVIGATION BAR ==================== */
    .main-nav {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 64px;
      background: var(--glass-bg);
      backdrop-filter: blur(24px);
      -webkit-backdrop-filter: blur(24px);
      border-bottom: 1px solid var(--glass-border);
      display: flex;
      align-items: center;
      padding: 0 24px;
      z-index: 100;
      box-shadow: var(--glass-shadow);
    }
    .nav-brand {
      display: flex;
      align-items: center;
      gap: 12px;
      font-weight: 800;
      font-size: 18px;
      color: var(--text-primary);
    }
    .nav-brand .logo-icon {
      width: 38px;
      height: 38px;
      background: var(--arca-gradient);
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      box-shadow: 0 4px 12px rgba(227,24,55,0.25);
    }
    .nav-items {
      display: flex;
      gap: 8px;
      margin-left: 40px;
    }
    .nav-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 20px;
      border: none;
      background: transparent;
      border-radius: 12px;
      font-weight: 600;
      font-size: 14px;
      color: var(--text-secondary);
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .nav-item:hover {
      background: rgba(227,24,55,0.08);
      color: var(--text-primary);
    }
    .nav-item.active {
      background: var(--arca-gradient);
      color: white;
      box-shadow: 0 4px 16px rgba(227,24,55,0.3);
    }
    .nav-item svg {
      width: 18px;
      height: 18px;
      fill: currentColor;
    }
    .nav-user {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 14px;
      color: var(--text-secondary);
    }
    .nav-user .user-avatar {
      width: 36px;
      height: 36px;
      font-size: 14px;
    }

    /* Main content area with nav offset */
    .app-container {
      display: flex;
      flex-direction: column;
      height: 100vh;
      padding-top: 64px;
      width: 100%;
    }
    .main-content {
      flex: 1;
      overflow: hidden;
      display: flex;
    }

    /* ==================== KPI DASHBOARD ==================== */
    .dashboard-view {
      flex: 1;
      overflow-y: auto;
      padding: 24px;
      background: linear-gradient(180deg, #FAFBFC 0%, #F1F5F9 100%);
    }
    .dashboard-header {
      margin-bottom: 24px;
    }
    .dashboard-header h1 {
      font-size: 28px;
      font-weight: 800;
      color: var(--text-primary);
      margin-bottom: 8px;
    }
    .dashboard-header p {
      color: var(--text-secondary);
      font-size: 15px;
    }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin-bottom: 24px;
    }
    .kpi-card {
      background: var(--glass-bg);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border-radius: 20px;
      padding: 24px;
      border: 1px solid var(--glass-border);
      box-shadow: var(--glass-shadow);
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .kpi-card:hover {
      transform: translateY(-4px);
      box-shadow: 0 12px 40px rgba(0,0,0,0.1);
    }
    .kpi-icon {
      width: 48px;
      height: 48px;
      border-radius: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 16px;
      font-size: 24px;
    }
    .kpi-icon.red { background: linear-gradient(135deg, rgba(227,24,55,0.15) 0%, rgba(255,77,106,0.1) 100%); }
    .kpi-icon.blue { background: linear-gradient(135deg, rgba(59,130,246,0.15) 0%, rgba(96,165,250,0.1) 100%); }
    .kpi-icon.green { background: linear-gradient(135deg, rgba(16,185,129,0.15) 0%, rgba(52,211,153,0.1) 100%); }
    .kpi-icon.purple { background: linear-gradient(135deg, rgba(139,92,246,0.15) 0%, rgba(167,139,250,0.1) 100%); }
    .kpi-value {
      font-size: 32px;
      font-weight: 800;
      color: var(--text-primary);
      line-height: 1;
    }
    .kpi-label {
      font-size: 14px;
      color: var(--text-secondary);
      margin-top: 6px;
      font-weight: 500;
    }
    .kpi-trend {
      font-size: 13px;
      margin-top: 12px;
      display: flex;
      align-items: center;
      gap: 4px;
      font-weight: 600;
    }
    .kpi-trend.up { color: var(--accent-green); }
    .kpi-trend.down { color: #EF4444; }
    .kpi-trend.neutral { color: var(--text-muted); }

    /* ==================== CHARTS ==================== */
    .charts-grid {
      display: grid;
      grid-template-columns: 2fr 1fr;
      gap: 20px;
    }
    @media (max-width: 1024px) {
      .charts-grid { grid-template-columns: 1fr; }
    }
    .chart-card {
      background: var(--glass-bg);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border-radius: 20px;
      padding: 24px;
      border: 1px solid var(--glass-border);
      box-shadow: var(--glass-shadow);
    }
    .chart-card.wide {
      grid-column: 1 / -1;
    }
    .chart-title {
      font-size: 16px;
      font-weight: 700;
      margin-bottom: 20px;
      color: var(--text-primary);
    }

    /* Bar Chart */
    .bar-chart {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .bar-item {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .bar-label {
      width: 100px;
      font-size: 13px;
      color: var(--text-secondary);
      font-weight: 500;
    }
    .bar-container {
      flex: 1;
      height: 28px;
      background: #F1F5F9;
      border-radius: 14px;
      overflow: hidden;
    }
    .bar-fill {
      height: 100%;
      border-radius: 14px;
      transition: width 0.6s ease;
      display: flex;
      align-items: center;
      padding-left: 12px;
    }
    .bar-value {
      width: 50px;
      text-align: right;
      font-weight: 700;
      font-size: 14px;
      color: var(--text-primary);
    }

    /* Donut Chart */
    .donut-container {
      display: flex;
      align-items: center;
      gap: 24px;
    }
    .donut-chart {
      width: 140px;
      height: 140px;
      border-radius: 50%;
      position: relative;
    }
    .donut-chart::before {
      content: '';
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 70px;
      height: 70px;
      background: white;
      border-radius: 50%;
    }
    .donut-legend {
      flex: 1;
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 12px;
      font-size: 14px;
    }
    .legend-color {
      width: 14px;
      height: 14px;
      border-radius: 4px;
    }
    .legend-value {
      margin-left: auto;
      font-weight: 700;
    }

    /* Line Chart */
    .line-chart {
      width: 100%;
      height: 200px;
    }
    .line-chart svg {
      width: 100%;
      height: 100%;
    }

    /* Conversations view wrapper */
    .conversations-view {
      display: flex;
      flex: 1;
      overflow: hidden;
    }
    .conversations-view .sidebar {
      height: auto;
    }

    /* Hide/show sections */
    .section-hidden { display: none !important; }
  </style>
</head>
<body>
  <!-- Navigation Bar -->
  <nav class="main-nav">
    <div class="nav-brand">
      <span class="logo-icon">🤖</span>
      <span>AC FIXBOT</span>
    </div>
    <div class="nav-items">
      <button class="nav-item active" data-section="dashboard" onclick="navigateTo('dashboard')">
        <svg viewBox="0 0 24 24"><path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/></svg>
        Dashboard
      </button>
      <button class="nav-item" data-section="conversations" onclick="navigateTo('conversations')">
        <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>
        Conversaciones
      </button>
    </div>
    <div class="nav-user">
      <span id="navUserName">Cargando...</span>
      <div class="user-avatar" id="navUserAvatar">?</div>
    </div>
  </nav>

  <!-- App Container -->
  <div class="app-container">
    <div class="main-content" id="mainContent">
      <!-- Dashboard View (Default) -->
      <div class="dashboard-view" id="dashboardView">
        <div class="dashboard-header">
          <h1>Dashboard</h1>
          <p>Resumen de actividad y métricas del sistema</p>
        </div>
        <div id="kpiContainer">
          <div class="loading"><div class="loading-spinner"></div>Cargando KPIs...</div>
        </div>
      </div>

      <!-- Conversations View (Hidden by default) -->
      <div class="conversations-view section-hidden" id="conversationsView">
        <div class="sidebar" id="sidebar">
          <div class="sidebar-header">
            <h1><span class="logo-icon">💬</span> Chats</h1>
            <button class="refresh-btn" onclick="refreshAll()" title="Actualizar" id="refreshBtn">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
            </button>
          </div>
          <div class="user-info" id="userInfo">
            <div class="user-avatar" id="userAvatar">?<div class="online-dot"></div></div>
            <div class="user-details">
              <div class="user-name" id="userName">Conectando...</div>
              <div class="user-role" id="userRole">Agente de Soporte</div>
            </div>
          </div>
          <div class="search-box">
            <input type="text" id="searchInput" placeholder="Buscar conversación..." onkeyup="handleSearch(event)">
          </div>
          <div class="conversations" id="conversationsList">
            <div class="loading"><div class="loading-spinner"></div>Cargando conversaciones...</div>
          </div>
        </div>
        <div class="chat-area" id="chatArea">
          <div class="empty-state">
            <div class="empty-state-icon">
              <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>
            </div>
            <h2>Selecciona una Conversación</h2>
            <p>Elige una conversación de la lista para ver el historial y responder a los usuarios</p>
          </div>
        </div>
      </div>
    </div>
  </div>
  <script>
    var API_BASE = '/api/conversations';
    var currentPhone = null;
    var currentSession = null;
    var autoRefreshChat = null;
    var autoRefreshList = null;
    var autoRefreshKpis = null;
    var lastMessageCount = 0;
    var lastMessageId = null;
    var lastSessionState = null;
    var lastChatDataHash = null;
    var lastConversationsHash = null;
    var lastKpisHash = null;
    var isFirstLoad = true;
    var currentSection = 'dashboard';
    var AGENT_ID = 'agent_' + Math.random().toString(36).substr(2, 9);
    var AGENT_NAME = '${userName.replace(/'/g, "\\'")}';
    var AGENT_EMAIL = '${userEmail.replace(/'/g, "\\'")}';
    if (AGENT_EMAIL) AGENT_ID = 'agent_' + AGENT_EMAIL.replace(/[^a-zA-Z0-9]/g, '_');

    // ==================== NAVIGATION ====================
    function navigateTo(section) {
      currentSection = section;
      // Update nav items
      document.querySelectorAll('.nav-item').forEach(function(item) {
        item.classList.toggle('active', item.dataset.section === section);
      });
      // Show/hide sections
      document.getElementById('dashboardView').classList.toggle('section-hidden', section !== 'dashboard');
      document.getElementById('conversationsView').classList.toggle('section-hidden', section !== 'conversations');
      // Load data for section
      if (section === 'dashboard') {
        loadKPIs();
        if (autoRefreshKpis) clearInterval(autoRefreshKpis);
        autoRefreshKpis = setInterval(loadKPIs, 60000);
      } else if (section === 'conversations') {
        loadConversations();
        if (autoRefreshList) clearInterval(autoRefreshList);
        autoRefreshList = setInterval(loadConversations, 30000);
      }
    }

    // ==================== KPIs DASHBOARD ====================
    async function loadKPIs() {
      var container = document.getElementById('kpiContainer');
      try {
        var res = await fetch(API_BASE + '/kpis');
        var data = await res.json();
        if (!data.success) throw new Error(data.error || 'Error cargando KPIs');

        // Hash comparison to avoid flickering
        var newHash = simpleHash(JSON.stringify(data));
        if (newHash === lastKpisHash) return;
        lastKpisHash = newHash;

        var kpis = data.kpis;
        var charts = data.charts;
        container.innerHTML = renderKPICards(kpis) + renderCharts(charts);
      } catch (err) {
        container.innerHTML = '<div class="empty-state"><h2>Error</h2><p>' + err.message + '</p></div>';
      }
    }

    function renderKPICards(kpis) {
      var trendIcon = kpis.tendenciaReportes >= 0 ? '↑' : '↓';
      var trendClass = kpis.tendenciaReportes > 0 ? 'up' : kpis.tendenciaReportes < 0 ? 'down' : 'neutral';
      return '<div class="kpi-grid">' +
        '<div class="kpi-card">' +
          '<div class="kpi-icon red">📋</div>' +
          '<div class="kpi-value">' + kpis.reportesHoy + '</div>' +
          '<div class="kpi-label">Reportes Hoy</div>' +
          '<div class="kpi-trend ' + trendClass + '">' + trendIcon + ' ' + Math.abs(kpis.tendenciaReportes) + '% vs ayer</div>' +
        '</div>' +
        '<div class="kpi-card">' +
          '<div class="kpi-icon blue">📊</div>' +
          '<div class="kpi-value">' + kpis.reportesSemana + '</div>' +
          '<div class="kpi-label">Reportes Semana</div>' +
        '</div>' +
        '<div class="kpi-card">' +
          '<div class="kpi-icon green">✅</div>' +
          '<div class="kpi-value">' + kpis.tasaResolucion + '%</div>' +
          '<div class="kpi-label">Tasa de Resolución</div>' +
        '</div>' +
        '<div class="kpi-card">' +
          '<div class="kpi-icon purple">⭐</div>' +
          '<div class="kpi-value">' + (kpis.satisfaccion || 'N/A') + '</div>' +
          '<div class="kpi-label">Satisfacción (1-5)</div>' +
        '</div>' +
        '<div class="kpi-card">' +
          '<div class="kpi-icon blue">💬</div>' +
          '<div class="kpi-value">' + kpis.sesionesActivas + '</div>' +
          '<div class="kpi-label">Sesiones Activas</div>' +
          '<div class="kpi-trend neutral">' + kpis.sesionesConAgente + ' con agente</div>' +
        '</div>' +
        '<div class="kpi-card">' +
          '<div class="kpi-icon green">📨</div>' +
          '<div class="kpi-value">' + kpis.mensajesHoy + '</div>' +
          '<div class="kpi-label">Mensajes Hoy</div>' +
          '<div class="kpi-trend neutral">' + kpis.mensajesEntrantes + ' ↓ / ' + kpis.mensajesSalientes + ' ↑</div>' +
        '</div>' +
      '</div>';
    }

    function renderCharts(charts) {
      return '<div class="charts-grid">' +
        renderBarChart(charts.porEstado) +
        renderDonutChart(charts.porTipo) +
        renderLineChart(charts.tendencia7dias) +
      '</div>';
    }

    function renderBarChart(data) {
      if (!data || data.length === 0) {
        return '<div class="chart-card"><div class="chart-title">Reportes por Estado</div><p style="color:var(--text-muted)">Sin datos</p></div>';
      }
      var maxVal = Math.max.apply(null, data.map(function(d) { return d.Total; })) || 1;
      var colors = {
        'PENDIENTE': '#EF4444',
        'EN_PROCESO': '#F59E0B',
        'RESUELTO': '#10B981',
        'CANCELADO': '#6B7280'
      };
      var emojis = { 'PENDIENTE': '⏳', 'EN_PROCESO': '🔧', 'RESUELTO': '✅', 'CANCELADO': '❌' };
      var bars = data.map(function(item) {
        var pct = Math.round((item.Total / maxVal) * 100);
        var color = colors[item.Estado] || '#3B82F6';
        var emoji = emojis[item.Estado] || '📋';
        return '<div class="bar-item">' +
          '<span class="bar-label">' + emoji + ' ' + item.EstadoNombre + '</span>' +
          '<div class="bar-container"><div class="bar-fill" style="width:' + pct + '%;background:' + color + '"></div></div>' +
          '<span class="bar-value">' + item.Total + '</span>' +
        '</div>';
      }).join('');
      return '<div class="chart-card"><div class="chart-title">Reportes por Estado (30 días)</div><div class="bar-chart">' + bars + '</div></div>';
    }

    function renderDonutChart(data) {
      if (!data || data.length === 0) {
        return '<div class="chart-card"><div class="chart-title">Por Tipo de Reporte</div><p style="color:var(--text-muted)">Sin datos</p></div>';
      }
      var total = data.reduce(function(sum, d) { return sum + d.Total; }, 0) || 1;
      var colors = ['#E31837', '#3B82F6', '#10B981', '#F59E0B'];
      var offset = 0;
      var gradientParts = data.map(function(item, i) {
        var pct = (item.Total / total) * 100;
        var start = offset;
        offset += pct;
        return colors[i % colors.length] + ' ' + start + '% ' + offset + '%';
      });
      var gradient = 'conic-gradient(' + gradientParts.join(', ') + ')';
      var legend = data.map(function(item, i) {
        var pct = Math.round((item.Total / total) * 100);
        return '<div class="legend-item">' +
          '<span class="legend-color" style="background:' + colors[i % colors.length] + '"></span>' +
          '<span>' + item.TipoNombre + '</span>' +
          '<span class="legend-value">' + item.Total + ' (' + pct + '%)</span>' +
        '</div>';
      }).join('');
      return '<div class="chart-card"><div class="chart-title">Por Tipo de Reporte</div>' +
        '<div class="donut-container">' +
          '<div class="donut-chart" style="background:' + gradient + '"></div>' +
          '<div class="donut-legend">' + legend + '</div>' +
        '</div></div>';
    }

    function renderLineChart(data) {
      if (!data || data.length === 0) {
        return '<div class="chart-card wide"><div class="chart-title">Tendencia Últimos 7 Días</div><p style="color:var(--text-muted)">Sin datos</p></div>';
      }
      var maxVal = Math.max.apply(null, data.map(function(d) { return d.Total; })) || 1;
      var width = 100;
      var height = 60;
      var padding = 10;
      var points = data.map(function(item, i) {
        var x = padding + (i / Math.max(data.length - 1, 1)) * (width - padding * 2);
        var y = height - padding - ((item.Total / maxVal) * (height - padding * 2));
        return x + ',' + y;
      });
      var polyline = '<polyline fill="none" stroke="url(#lineGrad)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" points="' + points.join(' ') + '"/>';
      var dots = data.map(function(item, i) {
        var x = padding + (i / Math.max(data.length - 1, 1)) * (width - padding * 2);
        var y = height - padding - ((item.Total / maxVal) * (height - padding * 2));
        return '<circle cx="' + x + '" cy="' + y + '" r="3" fill="#E31837"/>';
      }).join('');
      var labels = data.map(function(item, i) {
        var x = padding + (i / Math.max(data.length - 1, 1)) * (width - padding * 2);
        var date = new Date(item.Fecha);
        var label = date.toLocaleDateString('es-MX', { weekday: 'short' }).slice(0,2);
        return '<text x="' + x + '" y="' + (height - 2) + '" text-anchor="middle" font-size="6" fill="#64748B">' + label + '</text>';
      }).join('');
      var values = data.map(function(item, i) {
        var x = padding + (i / Math.max(data.length - 1, 1)) * (width - padding * 2);
        var y = height - padding - ((item.Total / maxVal) * (height - padding * 2));
        return '<text x="' + x + '" y="' + (y - 5) + '" text-anchor="middle" font-size="5" font-weight="600" fill="#0F172A">' + item.Total + '</text>';
      }).join('');
      return '<div class="chart-card wide"><div class="chart-title">Tendencia Últimos 7 Días</div>' +
        '<div class="line-chart"><svg viewBox="0 0 ' + width + ' ' + height + '" preserveAspectRatio="none">' +
        '<defs><linearGradient id="lineGrad" x1="0%" y1="0%" x2="100%" y2="0%">' +
        '<stop offset="0%" stop-color="#FF4D6A"/><stop offset="100%" stop-color="#E31837"/>' +
        '</linearGradient></defs>' +
        polyline + dots + labels + values +
        '</svg></div></div>';
    }

    async function initializeUser() {
      // La info del usuario ya viene del servidor via Easy Auth headers
      console.log('Usuario:', AGENT_NAME, 'Email:', AGENT_EMAIL);
      updateUserInfo();
      // Load dashboard by default
      loadKPIs();
      autoRefreshKpis = setInterval(loadKPIs, 60000);
    }

    function updateUserInfo() {
      var initials = AGENT_NAME.split(' ').map(function(w) { return w.charAt(0).toUpperCase(); }).slice(0, 2).join('') || AGENT_NAME.charAt(0).toUpperCase();
      // Update nav user
      document.getElementById('navUserName').textContent = AGENT_NAME;
      document.getElementById('navUserAvatar').textContent = initials;
      // Update sidebar user (conversations view)
      document.getElementById('userName').textContent = AGENT_NAME;
      document.getElementById('userAvatar').innerHTML = initials + '<div class="online-dot"></div>';
      document.getElementById('userRole').textContent = AGENT_EMAIL || 'Agente de Soporte';
    }

    function formatDate(dateStr) {
      if (!dateStr) return '';
      var date = new Date(dateStr);
      var now = new Date();
      var diff = now - date;
      if (diff < 86400000 && date.getDate() === now.getDate()) {
        return date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
      }
      if (diff < 172800000) return 'Ayer';
      return date.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit' });
    }

    function formatFullDate(dateStr) {
      if (!dateStr) return '';
      return new Date(dateStr).toLocaleString('es-MX', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' });
    }

    function maskPhone(phone) {
      if (!phone) return 'Usuario';
      var clean = phone.replace(/[^0-9]/g, '');
      if (clean.length >= 4) return '*** *** ' + clean.slice(-4);
      return '****';
    }

    function escapeHtml(text) {
      if (!text) return '';
      var div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function renderMarkdown(text) {
      if (!text) return '';
      // Escapar HTML primero para seguridad
      var html = escapeHtml(text);
      // Negritas: **texto** o __texto__
      html = html.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
      html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
      // Cursivas: *texto* o _texto_ (cuidado de no afectar negritas)
      html = html.replace(/(?<!\\*)\\*(?!\\*)(.+?)(?<!\\*)\\*(?!\\*)/g, '<em>$1</em>');
      html = html.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, '<em>$1</em>');
      // Código inline: \`código\`
      html = html.replace(/\`([^\`]+)\`/g, '<code style="background:rgba(0,0,0,0.2);padding:2px 6px;border-radius:4px;font-family:monospace;font-size:12px;">$1</code>');
      // Listas con viñetas: líneas que empiezan con - o •
      html = html.replace(/^[\\-•]\\s+(.+)$/gm, '<li style="margin-left:16px;list-style:disc inside;">$1</li>');
      // Listas numeradas: líneas que empiezan con número.
      html = html.replace(/^(\\d+)\\.\\s+(.+)$/gm, '<li style="margin-left:16px;list-style:decimal inside;">$2</li>');
      // Saltos de línea
      html = html.replace(/\\n/g, '<br>');
      // Limpiar <br> redundantes después de <li>
      html = html.replace(/<\\/li><br>/g, '</li>');
      return html;
    }

    // Función simple para crear hash de datos (evitar re-render innecesario)
    function simpleHash(str) {
      var hash = 0;
      for (var i = 0; i < str.length; i++) {
        var char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }
      return hash;
    }

    async function loadConversations() {
      var list = document.getElementById('conversationsList');
      try {
        var res = await fetch(API_BASE + '/list');
        var data = await res.json();
        if (!data.conversations || data.conversations.length === 0) {
          list.innerHTML = '<div class="loading">No hay conversaciones activas</div>';
          lastConversationsHash = null;
          return;
        }

        // Comparar hash para evitar re-render innecesario
        var newHash = simpleHash(JSON.stringify(data.conversations));
        if (newHash === lastConversationsHash) {
          return; // Sin cambios, no actualizar DOM
        }
        lastConversationsHash = newHash;

        list.innerHTML = data.conversations.map(function(conv) {
          var isAgent = conv.Estado === 'AGENTE_ACTIVO';
          var isFinalizado = conv.Estado && conv.Estado.indexOf('FINALIZADO') > -1;
          var statusClass = isAgent ? 'agente' : isFinalizado ? 'finalizado' : 'activo';
          var statusText = isAgent ? 'Agente' : isFinalizado ? 'Finalizado' : 'Activo';
          var displayName = conv.NombreUsuario || maskPhone(conv.Telefono);
          var initial = conv.NombreUsuario ? conv.NombreUsuario.charAt(0).toUpperCase() : (conv.TipoReporte || 'U').charAt(0).toUpperCase();
          return '<div class="conversation-item ' + (currentPhone === conv.Telefono ? 'active' : '') + '" onclick="loadChat(\\''+conv.Telefono+'\\')">' +
            '<div class="avatar ' + (isAgent ? 'agent' : '') + '">' + initial + '</div>' +
            '<div class="conv-info">' +
              '<div class="conv-header">' +
                '<span class="conv-name">' + displayName + '</span>' +
                '<span class="conv-time">' + formatDate(conv.FechaUltimoMensaje) + '</span>' +
              '</div>' +
              '<div class="conv-preview">' +
                '<span>' + (conv.TipoReporte || 'Sin tipo') + ' • ' + (conv.TotalMensajes || 0) + ' msgs</span>' +
                '<span class="status ' + statusClass + '">' + statusText + '</span>' +
              '</div>' +
            '</div>' +
          '</div>';
        }).join('');
      } catch (err) {
        list.innerHTML = '<div class="loading">Error al cargar conversaciones</div>';
      }
    }

    async function loadChat(phone) {
      // Capturar posición de scroll ANTES de hacer cualquier cambio
      var oldMsgs = document.getElementById('messagesContainer');
      var oldScrollTop = oldMsgs ? oldMsgs.scrollTop : 0;
      var oldScrollHeight = oldMsgs ? oldMsgs.scrollHeight : 0;
      var oldClientHeight = oldMsgs ? oldMsgs.clientHeight : 0;
      var wasAtBottom = !oldMsgs || (oldScrollHeight - oldScrollTop - oldClientHeight < 100);

      // Resetear tracking de scroll si cambiamos de conversación
      if (currentPhone !== phone) {
        isFirstLoad = true;
        lastChatDataHash = null;
        lastConversationsHash = null; // Forzar re-render de lista para actualizar clase active
      }
      currentPhone = phone;
      var chatArea = document.getElementById('chatArea');
      chatArea.classList.add('active');
      document.getElementById('sidebar').classList.add('hidden');
      try {
        var res = await fetch(API_BASE + '/chat/' + encodeURIComponent(phone));
        var data = await res.json();

        // Comparar hash completo de datos para evitar flickering
        var newChatHash = simpleHash(JSON.stringify(data));

        // Si no hay cambios, no actualizar el DOM (evita flickering)
        if (!isFirstLoad && newChatHash === lastChatDataHash) {
          // Sin cambios - solo programar siguiente refresh
          if (autoRefreshChat) clearInterval(autoRefreshChat);
          autoRefreshChat = setInterval(function() { if (currentPhone === phone) loadChat(phone); }, 5000);
          return;
        }
        lastChatDataHash = newChatHash;

        var messages = data.messages || [];
        var currentMsgCount = messages.length;

        currentSession = data.session;
        var session = data.session || {};
        var isAgentMode = session.Estado === 'AGENTE_ACTIVO';
        var displayName = session.NombreUsuario || maskPhone(phone);
        var userInitial = session.NombreUsuario ? session.NombreUsuario.charAt(0).toUpperCase() : (session.TipoReporte || 'U').charAt(0);
        var html = '<div class="chat-header">' +
          '<button class="back-btn" onclick="showSidebar()"><svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg></button>' +
          '<div class="avatar ' + (isAgentMode ? 'agent' : '') + '">' + userInitial + '</div>' +
          '<div class="chat-header-info"><h2>' + displayName + '</h2><span>' + maskPhone(phone) + ' • ' + (session.TipoReporte || 'Sin tipo') + '</span></div>' +
          '<div class="chat-header-actions">' +
            (!isAgentMode ? '<button class="btn btn-primary" onclick="takeoverChat()">Tomar control</button>' : '') +
            (isAgentMode ? '<button class="btn btn-danger" onclick="releaseChat()">Devolver al Bot</button>' : '') +
          '</div></div>';
        if (isAgentMode) {
          html += '<div class="agent-banner"><span>Controlada por: ' + (session.AgenteNombre || 'Agente') + '</span><span>Desde ' + formatFullDate(session.FechaTomaAgente) + '</span></div>';
        }
        html += '<div class="messages" id="messagesContainer">';
        var lastDate = null;
        (data.messages || []).forEach(function(msg) {
          var msgDate = new Date(msg.FechaCreacion).toDateString();
          if (msgDate !== lastDate) {
            html += '<div class="date-separator"><span>' + new Date(msg.FechaCreacion).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' }) + '</span></div>';
            lastDate = msgDate;
          }
          var isUser = msg.Tipo === 'U';
          var isAgentMsg = msg.AgenteId != null;
          var msgClass = isUser ? 'user' : (isAgentMsg ? 'agent' : 'bot');
          var sender = isUser ? (session.NombreUsuario || 'Usuario') : (isAgentMsg ? (msg.AgenteNombre || 'Agente') : 'Bot');
          var contenido = msg.Contenido || '';
          var contentHtml = '';
          var tipoContenido = (msg.TipoContenido || 'TEXTO').toUpperCase();
          if (tipoContenido === 'IMAGEN' || tipoContenido === 'IMAGE' || contenido.match(/\\.(jpg|jpeg|png|gif|webp)/i)) {
            if (contenido.indexOf('[IMG_PLACEHOLDER') === 0 || contenido.indexOf('[PLACEHOLDER') === 0 || !contenido.match(/^https?:\\/\\//i)) {
              contentHtml = '<div style="background:linear-gradient(135deg,rgba(139,92,246,0.15),rgba(59,130,246,0.15));padding:16px;border-radius:12px;text-align:center;"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(139,92,246,0.7)" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg><div style="margin-top:8px;color:rgba(255,255,255,0.6);font-size:12px;">📷 Imagen recibida</div></div>';
            } else {
              contentHtml = '<img src="'+contenido+'" alt="Imagen" class="msg-image" onclick="window.open(\\''+contenido+'\\', \\'_blank\\')">';
            }
          } else if (tipoContenido === 'UBICACION' || tipoContenido === 'LOCATION') {
            contentHtml = '<div style="background:rgba(16,185,129,0.1);padding:10px;border-radius:8px;">📍 Ubicación</div>';
          } else if (tipoContenido === 'AUDIO') {
            contentHtml = '<div style="background:rgba(59,130,246,0.1);padding:10px;border-radius:8px;">🎤 Audio</div>';
          } else {
            // Usar markdown para mensajes del bot/agente, texto plano para usuario
            contentHtml = isUser ? escapeHtml(contenido).replace(/\\n/g, '<br>') : renderMarkdown(contenido);
          }
          html += '<div class="message ' + msgClass + '">' +
            '<div class="message-sender">' + sender + '</div>' +
            '<div class="message-content">' + contentHtml + '</div>' +
            '<div class="message-time">' + formatFullDate(msg.FechaCreacion) + '</div>' +
          '</div>';
        });
        html += '</div>';
        html += '<div class="input-area">' +
          '<input type="text" id="messageInput" placeholder="' + (isAgentMode ? 'Escribe un mensaje...' : 'Toma el control para responder') + '" ' + (!isAgentMode ? 'disabled' : '') + ' onkeypress="if(event.key===\\'Enter\\')sendMessage()">' +
          '<button class="send-btn" onclick="sendMessage()" ' + (!isAgentMode ? 'disabled' : '') + '><svg width="20" height="20" viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg></button>' +
        '</div>';
        var hasNewMessages = currentMsgCount > lastMessageCount;
        var shouldScrollToBottom = isFirstLoad || hasNewMessages || wasAtBottom;

        chatArea.innerHTML = html;
        var msgs = document.getElementById('messagesContainer');

        if (msgs) {
          if (shouldScrollToBottom) {
            msgs.scrollTop = msgs.scrollHeight;
          } else {
            // Mantener posición (restaurar scroll anterior)
            msgs.scrollTop = oldScrollTop;
          }
        }

        // Actualizar variables de tracking
        lastMessageCount = currentMsgCount;
        isFirstLoad = false;
        loadConversations();
        if (autoRefreshChat) clearInterval(autoRefreshChat);
        autoRefreshChat = setInterval(function() { if (currentPhone === phone) loadChat(phone); }, 5000);
      } catch (err) {
        chatArea.innerHTML = '<div class="empty-state"><h2>Error</h2><p>' + err.message + '</p></div>';
      }
    }

    async function takeoverChat() {
      if (!currentPhone) return;
      try {
        var res = await fetch(API_BASE + '/takeover/' + encodeURIComponent(currentPhone), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agenteId: AGENT_ID, agenteNombre: AGENT_NAME })
        });
        var data = await res.json();
        if (data.success) loadChat(currentPhone);
        else alert('Error: ' + (data.error || 'No se pudo tomar el control'));
      } catch (err) { alert('Error de conexión'); }
    }

    async function releaseChat() {
      if (!currentPhone || !confirm('¿Devolver esta conversación al bot?')) return;
      try {
        var res = await fetch(API_BASE + '/release/' + encodeURIComponent(currentPhone), { method: 'POST', headers: { 'Content-Type': 'application/json' } });
        var data = await res.json();
        if (data.success) loadChat(currentPhone);
        else alert('Error: ' + (data.error || 'No se pudo liberar'));
      } catch (err) { alert('Error de conexión'); }
    }

    async function sendMessage() {
      var input = document.getElementById('messageInput');
      var mensaje = input.value.trim();
      if (!mensaje || !currentPhone) return;
      input.disabled = true;
      try {
        var res = await fetch(API_BASE + '/send/' + encodeURIComponent(currentPhone), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mensaje: mensaje, agenteId: AGENT_ID, agenteNombre: AGENT_NAME })
        });
        var data = await res.json();
        if (data.success) { input.value = ''; loadChat(currentPhone); }
        else alert('Error: ' + (data.error || 'No se pudo enviar'));
      } catch (err) { alert('Error de conexión'); }
      finally { input.disabled = false; input.focus(); }
    }

    async function handleSearch(event) {
      var query = event.target.value.trim();
      if (query.length === 0) { loadConversations(); return; }
      if (query.length < 3) return;
      var list = document.getElementById('conversationsList');
      try {
        var res = await fetch(API_BASE + '/search/' + encodeURIComponent(query));
        var data = await res.json();
        if (!data.results || data.results.length === 0) {
          list.innerHTML = '<div class="loading">No se encontraron resultados</div>';
          return;
        }
        list.innerHTML = data.results.map(function(conv) {
          return '<div class="conversation-item" onclick="loadChat(\\''+conv.Telefono+'\\')">' +
            '<div class="avatar">' + (conv.TipoReporte || 'U').charAt(0) + '</div>' +
            '<div class="conv-info">' +
              '<div class="conv-header"><span class="conv-name">' + maskPhone(conv.Telefono) + '</span><span class="conv-time">' + formatDate(conv.FechaUltimoMensaje) + '</span></div>' +
              '<div class="conv-preview">' + conv.TotalMensajes + ' mensajes</div>' +
            '</div></div>';
        }).join('');
      } catch (err) { list.innerHTML = '<div class="loading">Error en búsqueda</div>'; }
    }

    function refreshAll() {
      var btn = document.getElementById('refreshBtn');
      btn.classList.add('spinning');
      loadConversations();
      if (currentPhone) loadChat(currentPhone);
      setTimeout(function() { btn.classList.remove('spinning'); }, 500);
    }

    function showSidebar() {
      document.getElementById('sidebar').classList.remove('hidden');
      document.getElementById('chatArea').classList.remove('active');
    }

    initializeUser();
  </script>
</body>
</html>`;
}

/**
 * Azure Function handler para dashboard
 */
module.exports = async function (context, req) {
  try {
    // Obtener info del usuario desde headers de Azure Easy Auth
    let userName = 'Agente';
    let userEmail = '';

    // Azure inyecta estos headers cuando Easy Auth está habilitado
    const principalName = req.headers['x-ms-client-principal-name'];
    const principalId = req.headers['x-ms-client-principal-id'];
    const principal = req.headers['x-ms-client-principal'];

    if (principalName) {
      userName = principalName;
      if (principalName.indexOf('@') > -1) {
        userEmail = principalName;
        userName = principalName.split('@')[0].replace(/[._-]/g, ' ');
      }
    }

    // Si hay X-MS-CLIENT-PRINCIPAL (base64 encoded JSON), decodificar para más info
    if (principal) {
      try {
        const decoded = Buffer.from(principal, 'base64').toString('utf8');
        const principalData = JSON.parse(decoded);
        context.log('Principal data:', JSON.stringify(principalData));
        if (principalData.claims) {
          const nameClaim = principalData.claims.find(function (c) {
            return (
              c.typ === 'name' ||
              c.typ === 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'
            );
          });
          if (nameClaim && nameClaim.val) {
            userName = nameClaim.val;
          }

          const emailClaim = principalData.claims.find(function (c) {
            return (
              c.typ === 'email' ||
              c.typ === 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress' ||
              c.typ === 'preferred_username'
            );
          });
          if (emailClaim && emailClaim.val) {
            userEmail = emailClaim.val;
          }
        }
      } catch (e) {
        context.log('Error decoding principal:', e);
      }
    }

    context.log('User info - Name:', userName, 'Email:', userEmail);

    const html = getDashboardHTML(userName, userEmail);
    context.res = {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
      },
      body: html,
    };
  } catch (error) {
    context.log.error('Dashboard error:', error);
    context.res = {
      status: 500,
      headers: { 'Content-Type': 'text/html' },
      body: `<h1>Error</h1><p>No se pudo cargar el dashboard: ${error.message || 'Error desconocido'}</p>`,
    };
  }
};
