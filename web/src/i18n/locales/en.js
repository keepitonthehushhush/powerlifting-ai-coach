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
    appName: 'Coach Diaz',
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
    password: {
      met: 'Met',
      notMet: 'Not met',
      requirements: 'Your password needs:',
      length: 'At least 12 characters',
      lowercase: 'A lowercase letter',
      uppercase: 'An uppercase letter',
      digit: 'A number',
      symbol: 'A symbol, such as ! @ # $ %',
      weak: 'This password does not meet the requirements below yet.',
      managerHint: 'A password manager can generate and remember one for you.',
    },
  },

  log: {
    title: 'Log a session',
    subtitle:
      'What you actually lifted, not what was prescribed. Coach Diaz adjusts your next block from this, so an honest bad day is more useful than a tidy one.',
    date: 'Date',
    exercise: 'Movement',
    exercisePlaceholder: 'Squat, bench, RDL…',
    exerciseNumber: 'Exercise',
    sets: 'Sets',
    reps: 'Reps',
    weight: 'Weight',
    rpe: 'RPE',
    completed: 'Completed',
    notCompleted: 'not completed',
    remove: 'Remove',
    addExercise: '+ Add movement',
    notes: 'Notes',
    notesPlaceholder: 'Felt heavy, left knee cranky on the last set, cut it short…',
    submit: 'Save session',
    needExercise: 'Add at least one movement before saving.',
    backToCoach: 'Back to coach',
    recentTitle: 'Recent sessions',
  },
  intake: {
    dateOfBirth: 'Date of birth',
    dateOfBirthHint: 'Used to age-appropriate your programming. Coach Diaz cannot store injury or lifestyle information for under-18s yet, because consent for that has to come from a parent or guardian.',
    recoveryLegend: 'Recovery and lifestyle (optional)',
    recoveryNote: 'Every field here is optional and you can leave any of them blank. Training is only half of getting stronger — these tell the coach what recovery capacity it is actually programming for. Nothing here is judged, and none of it changes whether you get coached.',
    sleepHours: 'Typical hours of sleep a night',
    alcohol: 'Alcoholic drinks in a typical week',
    alcoholHint: 'A standard drink is roughly a 12oz beer, a 5oz glass of wine, or a 1.5oz shot.',
    nicotine: 'Nicotine use',
    nicotineNone: 'None',
    nicotineOccasional: 'Occasionally',
    nicotineDaily: 'Daily',
    preferNotToSay: 'Prefer not to say',
    nutrition: 'Anything about how you eat',
    nutritionPlaceholder: 'Cutting for a weight class, vegetarian, skip breakfast, whatever is relevant.',
    title: 'Your training profile',
    subtitle:
      'Coach Diaz uses this to write your program. Approximations are fine — it adjusts based on what you actually log.',
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
    squat: 'Squat — heaviest single',
    bench: 'Bench press — heaviest single',
    deadlift: 'Deadlift — heaviest single',
    liftsNote:
      'The most weight you have ever lifted for one rep on each — your one-rep max. If you have never tested a true max, put your best estimate or leave it blank; Coach Diaz will work it out from what you log. What matters is not entering a weight you did for several reps: your programming is calculated from these numbers, so a set of five entered as a max makes every prescribed weight too heavy.',
    goal: 'Goal',
    goalOptions: {
      general_strength: 'Get generally stronger',
      meet_prep: 'Compete in a powerlifting meet',
    },
    competitionDate: 'Competition date',
    daysPerWeek: 'Days per week you can train',
    smallestPlate: 'Smallest plate you have (optional)',
    smallestPlatePlaceholder: '2.5',
    smallestPlateHelp:
      'One plate, not a pair. Weight goes on both ends, so this sets the smallest jump you can make. Leave blank if you are not sure.',
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
    characterCount: '{count} of {limit} characters',
    logSession: 'Log session',
    editProfile: 'Edit profile',
    emptyPrompt:
      'Say hello and Coach Diaz will take it from there — it will ask what it needs before writing anything.',
    you: 'You',
    coach: 'Coach',
    thinking: 'Thinking…',
    placeholder: 'How did that session go?',
    send: 'Send',
    inputLabel: 'Message Coach Diaz',
    loadFailed: 'Could not load your conversation.',
    rateLimited: 'You have sent a lot of messages recently. Try again shortly.',
  },

  consent: {
    title: 'Your privacy choices',
    subtitle:
      'These are separate on purpose. You can change any of them later, and turning one off never turns off another.',
    required: '(required)',
    requiredToContinue: 'The required choices above must be accepted before you can continue.',
    continue: 'Continue to intake',
    readPolicy: 'Read the Consumer Health Data Privacy Policy',
    withdrawAnytime:
      'You can withdraw any of these at any time from this screen. Withdrawing is as easy as giving — one click, no email, no waiting.',
    recordedOn: 'Recorded {date} (version {version})',
    staleVersion: 'This policy has been updated since you agreed. Please review and confirm again.',
    healthDataCleared:
      'Consent withdrawn. The injury and health information we had stored has been erased.',
    terms_of_service: {
      label: 'Terms of service',
      description: 'The agreement covering your use of Coach, including the training-risk acknowledgement.',
    },
    ai_processing: {
      label: 'Sending your training data to our AI provider',
      description:
        'Your profile and training history are sent to Anthropic, which runs the AI model that writes your coaching. Without this, Coach cannot generate anything.',
    },
    health_data_collection: {
      label: 'Storing your injury and health information',
      description:
        'Optional. Lets Coach train you around injuries and enforce the medical-clearance rule. Coach works without it, just more conservatively. Turning this off erases what is already stored.',
    },
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
