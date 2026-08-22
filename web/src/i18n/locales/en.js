/**
 * English source catalogue. This is the reference: every other locale is
 * translated from here, and `t()` falls back to these strings when a key is
 * missing elsewhere.
 *
 * Keys are grouped by screen and named for meaning rather than for content, so
 * rewording a string does not require renaming a key across every locale.
 */
export const en = {
  common: {
    appName: 'Coach',
    loading: 'Loading…',
    saving: 'Saving…',
    working: 'Working…',
    signOut: 'Sign out',
    language: 'Language',
    somethingWentWrong: 'Something went wrong.',
  },

  medical: {
    disclaimer:
      'Coach is an AI tool, not a medical professional. If you have current pain, an injury, or a health condition, get clearance from a doctor or physical therapist before training.',
  },

  auth: {
    tagline: 'Structured powerlifting programming that adapts to what you actually lift.',
    email: 'Email',
    password: 'Password',
    signIn: 'Sign in',
    createAccount: 'Create account',
    toSignIn: 'Already have an account? Sign in',
    toSignUp: 'New here? Create an account',
    confirmEmail: 'Check your email to confirm your account, then sign in.',
  },

  intake: {
    title: 'Your training profile',
    subtitle:
      'Coach uses this to write your program. Approximations are fine — it adjusts based on what you actually log.',
    experience: 'Training experience',
    select: 'Select…',
    experienceOptions: {
      never_trained: 'Never trained with a barbell',
      some_experience: 'Some experience, not currently consistent',
      currently_training: 'Currently training consistently',
    },
    units: 'Units',
    unitOptions: { lb: 'Pounds (lb)', kg: 'Kilograms (kg)' },
    bodyweight: 'Bodyweight',
    squat: 'Squat',
    bench: 'Bench',
    deadlift: 'Deadlift',
    goal: 'Goal',
    goalOptions: {
      general_strength: 'Get generally stronger',
      meet_prep: 'Compete in a powerlifting meet',
    },
    competitionDate: 'Competition date',
    daysPerWeek: 'Days per week you can train',
    equipment: 'Equipment you have access to',
    equipmentPlaceholder: 'Full commercial gym; barbell, rack, bench, plates to 405…',
    healthLegend: 'Injuries, pain, or medical conditions',
    healthNote:
      'Coach needs this to train you safely. It is visible only to your account and is never written to application logs or error reports. Leave blank if none.',
    healthPlaceholder: 'e.g. left shoulder pain when benching; disc issue diagnosed 2023',
    clearedLabel: 'A doctor or physical therapist has cleared me to train with this condition.',
    clearanceWarning:
      'Coach will not write you a program until you have been cleared by a professional. It will still answer questions in the meantime.',
    submit: 'Save and talk to Coach',
    loadFailed: 'Could not load your profile.',
  },

  chat: {
    editProfile: 'Edit profile',
    emptyPrompt:
      'Say hello and Coach will take it from there — it will ask what it needs before writing anything.',
    you: 'You',
    coach: 'Coach',
    thinking: 'Thinking…',
    placeholder: 'How did that session go?',
    send: 'Send',
    inputLabel: 'Message Coach',
    loadFailed: 'Could not load your conversation.',
    rateLimited: 'You have sent a lot of messages recently. Try again shortly.',
  },

  account: {
    title: 'Your data',
    exportHeading: 'Download everything we hold about you',
    exportBody:
      'A machine-readable copy of your profile, programs, logged sessions and conversations, including the health information you provided.',
    exportButton: 'Download my data',
    deleteHeading: 'Delete your account',
    deleteBody:
      'Permanently removes your account and every associated record — profile, programs, sessions, progress logs and conversations. This cannot be undone.',
    deleteButton: 'Delete my account',
    deleteConfirmPrompt: 'Type DELETE MY ACCOUNT to confirm.',
    deleted: 'Your account and all associated data have been permanently deleted.',
  },
};
