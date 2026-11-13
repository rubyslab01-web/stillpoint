// Small inline SVG icon set standing in for the SF Symbols the native app uses.
const P = {
  'moon.stars.fill': '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" fill="currentColor" stroke="none"/><path d="M17 3v4M15 5h4M20.5 9v2M19.5 10h2" />',
  wind: '<path d="M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h8" />',
  'sun.max.fill': '<circle cx="12" cy="12" r="4.2" fill="currentColor" stroke="none"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" />',
  'waveform.path.ecg': '<path d="M2 12h4l2-5 3 10 3-12 2.5 7H22" />',
  'heart.fill': '<path d="M12 20.5s-7.5-4.6-9.2-9.3C1.7 8.1 3.7 4.5 7.2 4.5c2 0 3.6 1.1 4.8 2.8 1.2-1.7 2.8-2.8 4.8-2.8 3.5 0 5.5 3.6 4.4 6.7-1.7 4.7-9.2 9.3-9.2 9.3Z" fill="currentColor" stroke="none"/>',
  waveform: '<path d="M3 10v4M7 7v10M11 4v16M15 8v8M19 10v4" />',
  chart: '<path d="M3 3v18h18" /><path d="M7 15l4-4 3 3 6-7" />',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/><circle cx="12" cy="12" r="7"/>',
  play: '<path d="M7 4.5v15l13-7.5Z" fill="currentColor" stroke="none"/>',
  'play.circle': '<circle cx="12" cy="12" r="11" fill="currentColor" stroke="none"/><path d="M9.5 7.5v9l7.5-4.5Z" fill="#0E1220" stroke="none"/>',
  pause: '<path d="M7 4.5h3.5v15H7zM13.5 4.5H17v15h-3.5z" fill="currentColor" stroke="none"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>',
  headphones: '<path d="M4 15v-3a8 8 0 0 1 16 0v3" /><rect x="3" y="14" width="4.5" height="7" rx="1.5"/><rect x="16.5" y="14" width="4.5" height="7" rx="1.5"/>',
  speaker: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" stroke="none"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />',
  chevronRight: '<path d="M9 5l7 7-7 7" />',
  chevronLeft: '<path d="M15 5l-7 7 7 7" />',
  lifepreserver: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M5.6 5.6l3.6 3.6M14.8 14.8l3.6 3.6M18.4 5.6l-3.6 3.6M9.2 14.8l-3.6 3.6" />',
  phone: '<path d="M5 3.5h3.5l1.5 4.5-2.3 1.4a12 12 0 0 0 6.9 6.9l1.4-2.3 4.5 1.5V19a2 2 0 0 1-2 2A16.5 16.5 0 0 1 3 5.5a2 2 0 0 1 2-2Z" fill="currentColor" stroke="none"/>',
  info: '<circle cx="12" cy="12" r="9.5"/><path d="M12 11v6M12 7.5v.5" />',
  book: '<path d="M4 4.5A2 2 0 0 1 6 3h14v15H6a2 2 0 0 0-2 2Z" /><path d="M4 20a2 2 0 0 0 2 1h14" />',
  shield: '<path d="M12 2.5 4 5.5v6c0 5 3.4 8.7 8 10 4.6-1.3 8-5 8-10v-6Z"/><path d="M12 8v5M12 15.5v.5"/>',
  dice: '<rect x="3.5" y="3.5" width="17" height="17" rx="3.5"/><circle cx="8.5" cy="8.5" r="1.3" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/>',
  warning: '<path d="M12 3 2 20.5h20Z" fill="currentColor" stroke="none"/><path d="M12 9.5v5M12 17v.5" stroke="#0E1220" stroke-width="2.2"/>',
  check: '<circle cx="12" cy="12" r="10" fill="currentColor" stroke="none"/><path d="m7.5 12.5 3 3 6-6.5" stroke="#0E1220" stroke-width="2.2"/>',
  sparkles: '<path d="M10 3l1.6 4.4L16 9l-4.4 1.6L10 15l-1.6-4.4L4 9l4.4-1.6ZM18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8Z" fill="currentColor" stroke="none"/>',
  car: '<path d="M5 16h14M6.5 10.5 8 6h8l1.5 4.5" /><rect x="3.5" y="10.5" width="17" height="6.5" rx="2"/><path d="M6.5 17v2M17.5 17v2"/>',
  bolt: '<path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12Z" fill="currentColor" stroke="none"/>',
  ear: '<path d="M7 9a5 5 0 0 1 10 0c0 3-3 4-3 6.5a3 3 0 0 1-5.5 1.6" /><path d="M10 10a2 2 0 0 1 4 0c0 1-1 1.5-1.5 2" />',
  cross: '<rect x="3.5" y="6.5" width="17" height="13" rx="2.5"/><path d="M9 6.5V4.5h6v2M12 10v6M9 13h6" />',
  brain: '<path d="M9 4.5a3 3 0 0 0-3 3 3 3 0 0 0-1.5 5.5A3 3 0 0 0 7 18a3 3 0 0 0 5 1.5V6a3 3 0 0 0-3-1.5ZM15 4.5a3 3 0 0 1 3 3 3 3 0 0 1 1.5 5.5A3 3 0 0 1 17 18a3 3 0 0 1-5 1.5" />',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 20h16" />',
  trash: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13" />',
  screen: '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10.5 18.5h3"/>',
  replay: '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/>',
  globe: '<circle cx="12" cy="12" r="9.5"/><path d="M2.5 12h19M12 2.5c3 3.5 3 15.5 0 19M12 2.5c-3 3.5-3 15.5 0 19"/>',
};

export function icon(name, cls = '') {
  const body = P[name] ?? P.info;
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}
