// Where the donation link points, and whether it exists at all.
//
// Empty is the shipping default and it is load-bearing: with no URL set,
// nothing donation-related renders anywhere. That is deliberate rather than
// lazy. A tag pointing at a URL that 404s is worse than no tag -- it asks for
// money and then looks broken doing it, on the one page where a stranger is
// deciding whether this is a real thing.
//
// To turn it on, put the link here. Ko-fi, Buy Me a Coffee, PayPal.me, GitHub
// Sponsors, Stripe -- whatever the account actually is. One constant, both
// places, no other edit needed.
export const DONATION_URL = ''

// What the button says. Kept next to the URL because the two go together: a
// PayPal link labelled "buy me a coffee" is a small lie about where it goes.
export const DONATION_LABEL = 'Buy me a coffee'

export const donationsEnabled = () => Boolean(DONATION_URL)

// Whether the reminder at download time has been turned off. §6.5 wants the
// handoff to be persistent and unobtrusive; a request for money that reappears
// after someone has said no is neither.
const KEY = 'hide-donation-reminder'

export const reminderMuted = () => localStorage.getItem(KEY) === '1'
export const muteReminder = (muted) =>
  localStorage.setItem(KEY, muted ? '1' : '0')
