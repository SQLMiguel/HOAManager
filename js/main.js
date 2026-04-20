/* ===================================
   Glenridge Community — Main JavaScript
   =================================== */

document.addEventListener('DOMContentLoaded', () => {

  // ---------- Navbar scroll behavior ----------
  const navbar = document.getElementById('navbar');
  
  // Only apply scroll-based styling on pages with a full hero (index.html)
  const isHomePage = document.querySelector('.hero') !== null;

  if (isHomePage) {
    navbar.classList.remove('scrolled');
    
    const handleScroll = () => {
      if (window.scrollY > 60) {
        navbar.classList.add('scrolled');
      } else {
        navbar.classList.remove('scrolled');
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll(); // Check initial state
  }
  // Inner pages keep the 'scrolled' class set in HTML

  // ---------- Mobile hamburger menu ----------
  const hamburger = document.getElementById('hamburger');
  const navLinks = document.getElementById('navLinks');

  if (hamburger && navLinks) {
    hamburger.addEventListener('click', () => {
      hamburger.classList.toggle('active');
      navLinks.classList.toggle('open');
    });

    // Close menu when a link is clicked
    navLinks.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        hamburger.classList.remove('active');
        navLinks.classList.remove('open');
      });
    });

    // Close menu on outside click
    document.addEventListener('click', (e) => {
      if (!hamburger.contains(e.target) && !navLinks.contains(e.target)) {
        hamburger.classList.remove('active');
        navLinks.classList.remove('open');
      }
    });
  }

  // ---------- Scroll-triggered animations ----------
  const fadeElements = document.querySelectorAll('.fade-in');

  if (fadeElements.length > 0) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry, index) => {
        if (entry.isIntersecting) {
          // Stagger the animation slightly for items in grids
          setTimeout(() => {
            entry.target.classList.add('visible');
          }, index * 80);
          observer.unobserve(entry.target);
        }
      });
    }, {
      threshold: 0.1,
      rootMargin: '0px 0px -40px 0px'
    });

    fadeElements.forEach(el => observer.observe(el));
  }

  // ---------- Lightbox for gallery ----------
  const lightbox = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightboxImg');
  const lightboxClose = document.getElementById('lightboxClose');

  if (lightbox && lightboxImg) {
    // Open lightbox when gallery item is clicked
    document.querySelectorAll('.gallery-item').forEach(item => {
      item.addEventListener('click', () => {
        const img = item.querySelector('img');
        if (img) {
          lightboxImg.src = img.src;
          lightboxImg.alt = img.alt;
          lightbox.classList.add('active');
          document.body.style.overflow = 'hidden';
        }
      });
    });

    // Close lightbox
    const closeLightbox = () => {
      lightbox.classList.remove('active');
      document.body.style.overflow = '';
      lightboxImg.src = '';
    };

    if (lightboxClose) {
      lightboxClose.addEventListener('click', closeLightbox);
    }

    lightbox.addEventListener('click', (e) => {
      if (e.target === lightbox) {
        closeLightbox();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && lightbox.classList.contains('active')) {
        closeLightbox();
      }
    });
  }

  // ---------- Contact form handling ----------
  const contactForm = document.getElementById('contactForm');

  if (contactForm) {
    contactForm.addEventListener('submit', (e) => {
      e.preventDefault();

      const formData = new FormData(contactForm);
      const data = Object.fromEntries(formData.entries());

      // Simple validation
      if (!data.fullName || !data.email || !data.comments) {
        showNotification('Please fill in all required fields.', 'error');
        return;
      }

      if (!FormValidation.isValidEmail(data.email)) {
        showNotification('Please enter a valid email address.', 'error');
        return;
      }

      // Simulate form submission
      const submitBtn = contactForm.querySelector('button[type="submit"]');
      const originalText = submitBtn.innerHTML;
      submitBtn.innerHTML = 'Sending...';
      submitBtn.disabled = true;

      setTimeout(() => {
        showNotification('Thank you for your message! Someone will get back to you within 3–5 business days. For immediate assistance, please contact our HOA Management company directly.', 'success');
        contactForm.reset();
        submitBtn.innerHTML = originalText;
        submitBtn.disabled = false;
      }, 1500);
    });
  }

  // ---------- Notification helper ----------
  function showNotification(message, type = 'info') {
    // Remove existing notifications
    document.querySelectorAll('.notification').forEach(n => n.remove());

    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
      <p>${message}</p>
      <button class="notification-close" aria-label="Close notification">&times;</button>
    `;

    // Styles
    Object.assign(notification.style, {
      position: 'fixed',
      top: '90px',
      right: '24px',
      maxWidth: '420px',
      padding: '18px 24px',
      borderRadius: '12px',
      background: type === 'success' ? '#2d6a4f' : type === 'error' ? '#c0392b' : '#2b2b2b',
      color: '#ffffff',
      boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
      zIndex: '3000',
      display: 'flex',
      alignItems: 'flex-start',
      gap: '12px',
      animation: 'slideInRight 0.4s ease',
      fontFamily: 'var(--font-body)',
      fontSize: '0.95rem',
      lineHeight: '1.5'
    });

    // Add animation keyframes if not already added
    if (!document.getElementById('notificationStyles')) {
      const style = document.createElement('style');
      style.id = 'notificationStyles';
      style.textContent = `
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes slideOutRight {
          from { transform: translateX(0); opacity: 1; }
          to { transform: translateX(100%); opacity: 0; }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(notification);

    // Close button
    const closeBtn = notification.querySelector('.notification-close');
    Object.assign(closeBtn.style, {
      background: 'none',
      border: 'none',
      color: '#ffffff',
      fontSize: '1.3rem',
      cursor: 'pointer',
      padding: '0',
      lineHeight: '1',
      opacity: '0.7'
    });

    const removeNotification = () => {
      notification.style.animation = 'slideOutRight 0.3s ease';
      setTimeout(() => notification.remove(), 300);
    };

    closeBtn.addEventListener('click', removeNotification);

    // Auto-remove after 8 seconds
    setTimeout(removeNotification, 8000);
  }

  // ---------- Smooth scroll for anchor links ----------
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', (e) => {
      const targetId = anchor.getAttribute('href');
      if (targetId === '#') return;
      
      const target = document.querySelector(targetId);
      if (target) {
        e.preventDefault();
        const navHeight = navbar ? navbar.offsetHeight : 0;
        const targetPosition = target.getBoundingClientRect().top + window.scrollY - navHeight - 20;
        window.scrollTo({ top: targetPosition, behavior: 'smooth' });
      }
    });
  });

  // ── Members Page Auth ─────────────────────────────────
  const authSection = document.getElementById('authSection');
  const welcomeSection = document.getElementById('welcomeSection');

  if (authSection && welcomeSection) {
    const loginCard = document.getElementById('loginCard');
    const signupCard = document.getElementById('signupCard');
    const socialCompleteCard = document.getElementById('socialCompleteCard');
    const showLoginBtn = document.getElementById('showLoginBtn');
    const showSignupBtn = document.getElementById('showSignupBtn');
    const switchToSignup = document.getElementById('switchToSignup');
    const switchToLogin = document.getElementById('switchToLogin');
    const loginForm = document.getElementById('loginForm');
    const signupForm = document.getElementById('signupForm');
    const socialCompleteForm = document.getElementById('socialCompleteForm');
    const loginError = document.getElementById('loginError');
    const signupError = document.getElementById('signupError');
    const logoutBtn = document.getElementById('logoutBtn');
    const welcomeName = document.getElementById('welcomeName');

    // Check auth status on page load, then handle any OAuth redirect params
    checkAuth().then(() => handleOAuthParams());

    async function checkAuth() {
      try {
        const res = await fetch('/api/me');
        const data = await res.json();
        if (data.authenticated) {
          showLoggedInState(data.user);
          return true;
        }
      } catch (e) {
        // Server not running or unreachable — stay in unauthenticated state
      }
      return false;
    }

    async function handleOAuthParams() {
      const params = new URLSearchParams(window.location.search);
      const oauth = params.get('oauth');
      if (!oauth) return;

      // Clean up URL without reloading
      history.replaceState({}, '', window.location.pathname);

      if (oauth === 'success') {
        // Session already set server-side — re-check auth to populate UI
        const res = await fetch('/api/me');
        const data = await res.json();
        if (data.authenticated) {
          showLoggedInState(data.user);
          showNotification(`Welcome back, ${data.user.firstName}!`, 'success');
        }
      } else if (oauth === 'new_user') {
        // Fetch the pending social profile from session
        try {
          const res = await fetch('/api/auth/pending-social');
          const data = await res.json();
          if (data.hasPending) {
            showSocialCompleteCard(data);
          } else {
            showNotification('Social login session expired. Please try again.', 'error');
          }
        } catch (e) {
          showNotification('Unable to complete social login. Please try again.', 'error');
        }
      } else if (oauth === 'pending') {
        authSection.style.display = '';
        showNotification('Your account is pending admin approval. You will receive an email once approved.', 'info');
      } else if (oauth === 'denied') {
        authSection.style.display = '';
        showNotification('Your account application was not approved. Contact admin@glenridgecommunity.com for assistance.', 'error');
      } else if (oauth === 'error') {
        showNotification('An error occurred during social login. Please try again or use email/password.', 'error');
      } else if (oauth === 'not_configured') {
        showNotification('Social login is not yet configured. Please sign up with email and password.', 'error');
      }
    }

    function showSocialCompleteCard(profile) {
      authSection.style.display = '';
      welcomeSection.style.display = 'none';
      loginCard.style.display = 'none';
      signupCard.style.display = 'none';
      socialCompleteCard.style.display = 'block';

      // Pre-fill name fields from OAuth profile
      if (profile.firstName) document.getElementById('scFirst').value = profile.firstName;
      if (profile.lastName)  document.getElementById('scLast').value  = profile.lastName;

      const providerLabel = profile.provider
        ? profile.provider.charAt(0).toUpperCase() + profile.provider.slice(1)
        : 'Social';
      document.getElementById('socialCompleteIntro').textContent =
        `You signed in with ${providerLabel} (${profile.email || 'no email shared'}). ` +
        `Please confirm your name and provide your Glenridge address so we can verify your residency.`;

      socialCompleteCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function showLoggedInState(user) {
      authSection.style.display = 'none';
      welcomeSection.style.display = '';
      welcomeName.textContent = user.firstName;
    }

    function showLoggedOutState() {
      authSection.style.display = '';
      welcomeSection.style.display = 'none';
      loginCard.style.display = 'none';
      signupCard.style.display = 'none';
      if (socialCompleteCard) socialCompleteCard.style.display = 'none';
    }

    // Show/hide forms
    showLoginBtn.addEventListener('click', () => {
      loginCard.style.display = 'block';
      signupCard.style.display = 'none';
      if (socialCompleteCard) socialCompleteCard.style.display = 'none';
      loginCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    showSignupBtn.addEventListener('click', () => {
      signupCard.style.display = 'block';
      loginCard.style.display = 'none';
      if (socialCompleteCard) socialCompleteCard.style.display = 'none';
      signupCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    switchToSignup.addEventListener('click', (e) => {
      e.preventDefault();
      signupCard.style.display = 'block';
      loginCard.style.display = 'none';
      if (socialCompleteCard) socialCompleteCard.style.display = 'none';
      signupCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    switchToLogin.addEventListener('click', (e) => {
      e.preventDefault();
      loginCard.style.display = 'block';
      signupCard.style.display = 'none';
      if (socialCompleteCard) socialCompleteCard.style.display = 'none';
      loginCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    // Login form submit
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      loginError.textContent = '';
      const btn = document.getElementById('loginSubmitBtn');
      btn.disabled = true;
      btn.textContent = 'Logging in...';

      try {
        const res = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: document.getElementById('loginEmail').value,
            password: document.getElementById('loginPassword').value
          })
        });
        const data = await res.json();

        if (data.success) {
          showLoggedInState(data.user);
          showNotification(`Welcome back, ${data.user.firstName}!`, 'success');
        } else {
          loginError.textContent = data.error;
        }
      } catch (err) {
        loginError.textContent = 'Unable to connect to server. Please try again later.';
      }

      btn.disabled = false;
      btn.textContent = 'Log In';
    });

    // Signup form submit
    signupForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      signupError.textContent = '';
      const btn = document.getElementById('signupSubmitBtn');
      btn.disabled = true;
      btn.textContent = 'Creating Account...';

      const emailVal = document.getElementById('signupEmail').value;
      if (!FormValidation.isValidEmail(emailVal)) {
        signupError.textContent = 'Please enter a valid email address.';
        btn.disabled = false;
        btn.textContent = 'Create Account';
        return;
      }

      const phoneVal = document.getElementById('signupPhone').value;
      if (!FormValidation.isValidPhone(phoneVal)) {
        signupError.textContent = 'Phone number must be 10 digits.';
        btn.disabled = false;
        btn.textContent = 'Create Account';
        return;
      }

      const password = document.getElementById('signupPassword').value;
      const confirmPassword = document.getElementById('signupConfirm').value;

      if (password !== confirmPassword) {
        signupError.textContent = 'Passwords do not match.';
        btn.disabled = false;
        btn.textContent = 'Create Account';
        return;
      }

      if (password.length < 8) {
        signupError.textContent = 'Password must be at least 8 characters.';
        btn.disabled = false;
        btn.textContent = 'Create Account';
        return;
      }

      try {
        const res = await fetch('/api/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            firstName: document.getElementById('signupFirst').value,
            lastName: document.getElementById('signupLast').value,
            email: document.getElementById('signupEmail').value,
            address: document.getElementById('signupAddress').value,
            phone: document.getElementById('signupPhone').value,
            password,
            confirmPassword
          })
        });
        const data = await res.json();

        if (data.success) {
          signupForm.reset();
          signupCard.innerHTML = `
            <div class="auth-success">
              <h3 style="margin-bottom:8px; color:#155724;">Account Created!</h3>
              <p>${data.message}</p>
            </div>
            <p class="auth-toggle"><a href="#" onclick="location.reload(); return false;">Back to Login</a></p>
          `;
        } else {
          signupError.textContent = data.error;
        }
      } catch (err) {
        signupError.textContent = 'Unable to connect to server. Please try again later.';
      }

      btn.disabled = false;
      btn.textContent = 'Create Account';
    });

    // Social complete form submit
    if (socialCompleteForm) {
      socialCompleteForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const errEl = document.getElementById('socialCompleteError');
        errEl.textContent = '';
        const btn = document.getElementById('socialCompleteBtn');
        btn.disabled = true;
        btn.textContent = 'Submitting...';

        const scPhoneVal = document.getElementById('scPhone').value;
        if (!FormValidation.isValidPhone(scPhoneVal)) {
          errEl.textContent = 'Phone number must be 10 digits.';
          btn.disabled = false;
          btn.textContent = 'Submit for Approval';
          return;
        }

        try {
          const res = await fetch('/api/auth/social-complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              firstName: document.getElementById('scFirst').value,
              lastName:  document.getElementById('scLast').value,
              address:   document.getElementById('scAddress').value,
              phone:     document.getElementById('scPhone').value
            })
          });

          const data = await res.json();

          if (data.success) {
            socialCompleteCard.innerHTML = `
              <div class="auth-success">
                <h3 style="margin-bottom:8px; color:#155724;">Account Submitted!</h3>
                <p>${data.message}</p>
              </div>
              <p class="auth-toggle"><a href="#" onclick="location.reload(); return false;">Back to Login</a></p>
            `;
          } else {
            errEl.textContent = data.error;
            btn.disabled = false;
            btn.textContent = 'Submit for Approval';
          }
        } catch (err) {
          errEl.textContent = 'Unable to connect to server. Please try again later.';
          btn.disabled = false;
          btn.textContent = 'Submit for Approval';
        }
      });
    }

    // Logout
    logoutBtn.addEventListener('click', async () => {
      try {
        await fetch('/api/logout', { method: 'POST' });
      } catch (e) {}
      showLoggedOutState();
      showNotification('You have been logged out.', 'info');
    });
  }

  // ── Community Events Calendar ─────────────────────────
  const calendarSection = document.getElementById('calendarSection');
  const viewEventsBtn   = document.getElementById('viewEventsBtn');

  if (calendarSection && viewEventsBtn) {
    let calYear, calMonth, allEvents = [], selectedDate = null;

    viewEventsBtn.addEventListener('click', async () => {
      // Must be logged in
      try {
        const r = await fetch('/api/me');
        const d = await r.json();
        if (!d.authenticated) {
          showNotification('Please log in to view the events calendar.', 'error');
          document.getElementById('authSection')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return;
        }
      } catch (e) {
        showNotification('Unable to connect to server.', 'error');
        return;
      }

      calendarSection.style.display = '';
      calendarSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const now = new Date();
      calYear  = now.getFullYear();
      calMonth = now.getMonth();
      await loadEvents();
      renderCalendar();
      renderUpcoming();
    });

    async function loadEvents() {
      try {
        const res = await fetch('/api/events');
        if (!res.ok) { allEvents = []; return; }
        allEvents = await res.json();
      } catch (e) { allEvents = []; }
    }

    function eventsOnDate(dateStr) {
      return allEvents.filter(e => e.event_date === dateStr);
    }

    function formatDateLabel(dateStr) {
      const [y, m, d] = dateStr.split('-').map(Number);
      return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    }

    function formatTime(t) {
      if (!t) return '';
      const [h, min] = t.split(':').map(Number);
      const ampm = h >= 12 ? 'PM' : 'AM';
      const hr = h % 12 || 12;
      return `${hr}:${min.toString().padStart(2, '0')} ${ampm}`;
    }

    function isoDate(y, m, d) {
      return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }

    function todayStr() {
      const t = new Date();
      return isoDate(t.getFullYear(), t.getMonth(), t.getDate());
    }

    function renderCalendar() {
      const label = document.getElementById('calMonthLabel');
      const grid  = document.getElementById('calGrid');
      label.textContent = new Date(calYear, calMonth, 1)
        .toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

      // Remove old day cells (keep the 7 DOW headers)
      const headers = grid.querySelectorAll('.cal-dow');
      grid.innerHTML = '';
      headers.forEach(h => grid.appendChild(h));

      const firstDay = new Date(calYear, calMonth, 1).getDay();
      const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
      const today = todayStr();

      // Blank cells before month starts
      for (let i = 0; i < firstDay; i++) {
        const blank = document.createElement('div');
        blank.className = 'cal-day cal-day-blank';
        grid.appendChild(blank);
      }

      for (let d = 1; d <= daysInMonth; d++) {
        const ds = isoDate(calYear, calMonth, d);
        const evs = eventsOnDate(ds);
        const cell = document.createElement('button');
        cell.className = 'cal-day';
        cell.type = 'button';
        if (ds === today) cell.classList.add('cal-today');
        if (ds === selectedDate) cell.classList.add('cal-selected');
        cell.innerHTML = `<span class="cal-day-num">${d}</span>${evs.length ? `<span class="cal-dot"></span>` : ''}`;
        cell.addEventListener('click', () => selectDate(ds));
        grid.appendChild(cell);
      }
    }

    function selectDate(ds) {
      selectedDate = ds;
      renderCalendar();           // re-render to apply .cal-selected
      renderDayEvents(ds);
    }

    function renderDayEvents(ds) {
      const label = document.getElementById('calSelectedLabel');
      const list  = document.getElementById('calEventsList');
      label.textContent = formatDateLabel(ds);
      const evs = eventsOnDate(ds);

      if (!evs.length) {
        list.innerHTML = '<p class="cal-empty">No events on this day.</p>';
        return;
      }

      list.innerHTML = evs.map(e => eventCard(e, true)).join('');
      attachDeleteHandlers(list);
    }

    function renderUpcoming() {
      const container = document.getElementById('calUpcomingList');
      const today = todayStr();
      const upcoming = allEvents
        .filter(e => e.event_date >= today)
        .slice(0, 8);

      if (!upcoming.length) {
        container.innerHTML = '<p class="cal-empty">No upcoming events. Be the first to add one!</p>';
        return;
      }
      container.innerHTML = upcoming.map(e => eventCard(e, false)).join('');
      attachDeleteHandlers(container);
    }

    function eventCard(e, compact) {
      const timeStr  = e.event_time ? formatTime(e.event_time) : 'All day';
      const locStr   = e.location   ? `<span class="cal-ev-loc">📍 ${e.location}</span>` : '';
      const descStr  = e.description ? `<p class="cal-ev-desc">${e.description}</p>` : '';
      const dateStr  = !compact ? `<span class="cal-ev-date">${formatDateLabel(e.event_date)}</span>` : '';
      return `
        <div class="cal-event-item" data-id="${e.id}">
          <div class="cal-ev-header">
            <strong class="cal-ev-title">${e.title}</strong>
            <button class="cal-ev-delete" data-id="${e.id}" title="Delete event" aria-label="Delete event">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
              </svg>
            </button>
          </div>
          ${dateStr}
          <span class="cal-ev-meta">${timeStr}</span>
          ${locStr}${descStr}
          <span class="cal-ev-by">Added by ${e.created_by_name}</span>
        </div>`;
    }

    function attachDeleteHandlers(container) {
      container.querySelectorAll('.cal-ev-delete').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this event?')) return;
          const id = btn.dataset.id;
          try {
            const res = await fetch(`/api/events/${id}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.success) {
              await loadEvents();
              renderCalendar();
              renderUpcoming();
              if (selectedDate) renderDayEvents(selectedDate);
              showNotification('Event deleted.', 'success');
            } else {
              showNotification(data.error || 'Could not delete event.', 'error');
            }
          } catch (e) {
            showNotification('Unable to connect to server.', 'error');
          }
        });
      });
    }

    // Calendar navigation
    document.getElementById('calPrev').addEventListener('click', () => {
      calMonth--;
      if (calMonth < 0) { calMonth = 11; calYear--; }
      renderCalendar();
    });
    document.getElementById('calNext').addEventListener('click', () => {
      calMonth++;
      if (calMonth > 11) { calMonth = 0; calYear++; }
      renderCalendar();
    });

    // Add event form
    const addForm    = document.getElementById('addEventForm');
    const openAddBtn = document.getElementById('openAddEventBtn');
    const cancelBtn  = document.getElementById('cancelAddEventBtn');
    const saveBtn    = document.getElementById('saveEventBtn');

    openAddBtn.addEventListener('click', () => {
      addForm.style.display = '';
      // Pre-fill date with selected day
      if (selectedDate) document.getElementById('evDate').value = selectedDate;
      else document.getElementById('evDate').value = todayStr();
      addForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    // Pool party radio → show/hide AquaTech notice
    document.querySelectorAll('input[name="evPoolParty"]').forEach(radio => {
      radio.addEventListener('change', () => {
        const notice = document.getElementById('aquatechNotice');
        const selected = document.querySelector('input[name="evPoolParty"]:checked');
        notice.style.display = selected && selected.value === 'yes' ? 'block' : 'none';
      });
    });

    cancelBtn.addEventListener('click', () => {
      addForm.style.display = 'none';
      document.getElementById('addEventError').textContent = '';
      document.querySelectorAll('input[name="evPoolParty"]').forEach(r => r.checked = false);
      document.getElementById('aquatechNotice').style.display = 'none';
      document.getElementById('evAquatechAck').checked = false;
    });

    saveBtn.addEventListener('click', async () => {
      const errEl = document.getElementById('addEventError');
      errEl.textContent = '';
      const title    = document.getElementById('evTitle').value.trim();
      const date     = document.getElementById('evDate').value;
      const time     = document.getElementById('evTime').value;
      const location = document.getElementById('evLocation').value.trim();
      const desc     = document.getElementById('evDesc').value.trim();
      const poolPartyRadio = document.querySelector('input[name="evPoolParty"]:checked');

      if (!title || !date) {
        errEl.textContent = 'Title and date are required.';
        return;
      }
      if (!poolPartyRadio) {
        errEl.textContent = 'Please indicate whether this is a pool party (Yes or No).';
        return;
      }
      if (poolPartyRadio.value === 'yes' && !document.getElementById('evAquatechAck').checked) {
        errEl.textContent = 'You must acknowledge the AquaTech pool party requirement before saving.';
        document.getElementById('aquatechNotice').scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }

      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
      try {
        const res = await fetch('/api/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, event_date: date, event_time: time || null, location: location || null, description: desc || null })
        });
        const data = await res.json();
        if (data.success) {
          // Reset form
          ['evTitle','evDate','evTime','evLocation','evDesc'].forEach(id => document.getElementById(id).value = '');
          document.querySelectorAll('input[name="evPoolParty"]').forEach(r => r.checked = false);
          document.getElementById('aquatechNotice').style.display = 'none';
          document.getElementById('evAquatechAck').checked = false;
          addForm.style.display = 'none';
          await loadEvents();
          // Navigate to the month of the new event
          const [y, m] = date.split('-').map(Number);
          calYear = y; calMonth = m - 1;
          selectDate(date);
          renderUpcoming();
          showNotification('Event added!', 'success');
        } else {
          errEl.textContent = data.error || 'Could not save event.';
        }
      } catch (e) {
        errEl.textContent = 'Unable to connect to server.';
      }
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Event';
    });
  }

});
