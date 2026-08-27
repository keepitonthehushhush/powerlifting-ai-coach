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
    backToTop: 'Back to top',
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
    sessionEnded: 'You were signed out and we are not sure why — please sign in again. If this keeps happening, the code in brackets tells us what went wrong.',
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
    breachChecking: 'Checking this password against known breaches…',
    breachSafe: 'Not found in any known breach.',
    breached: 'This password has appeared in {count} known data breaches. Please choose a different one — it is one of the first an attacker will try.',
    breachedBlocked: 'That password appears in known data breaches. Choose a different one to continue.',
    breachUnknown: 'Could not reach the breach-check service, so this password has not been checked. You can still continue.',
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
    recentTitle: 'Recent sessions',
  },
  intake: {
    dateOfBirth: 'Date of birth',
    dateOfBirthHint: 'Used to age-appropriate your programming. Coach Diaz cannot store injury or lifestyle information for under-18s yet, because consent for that has to come from a parent or guardian.',

    aboutYouLegend: 'About you',
    liftsLegend: 'Your best lifts',
    trainingLegend: 'How you train',

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

    experience: 'How long have you been training with a barbell?',
    experienceHint: 'Consistently, not counting long breaks. If you are not sure, round down.',
    select: 'Select…',
    experienceOptions: {
      never_lifted: 'I have never used a barbell',
      learning_lifts: 'I have used one, but I am still learning the movements',
      under_6_months: 'Less than 6 months',
      six_to_24_months: '6 months to 2 years',
      over_2_years: 'More than 2 years',
    },

    cadence: 'Lately, how often have you been able to add weight to the bar?',
    cadenceHint:
      'Your honest recollection of the last couple of months. This is the single most useful thing you can tell the coach — it decides whether the programming here still fits you, and there is no wrong answer.',
    cadenceOptions: {
      every_session: 'Almost every session',
      every_week: 'About once a week',
      every_month_or_slower: 'Once a month or slower',
      stalled: 'It has not gone up in a while',
      no_history: 'I have not been training, so there is nothing to go on',
    },

    units: 'Units',
    unitOptions: { lb: 'Pounds (lb)', kg: 'Kilograms (kg)' },
    bodyweight: 'What do you weigh?',
    squat: 'The most weight you can SQUAT for one rep',
    bench: 'The most weight you can BENCH PRESS for one rep',
    deadlift: 'The most weight you can DEADLIFT for one rep',
    oneRepHint: 'One rep, not a set. Leave blank if you have never found out.',
    liftsNote:
      'These three numbers are what your first program is calculated from, so the one thing worth getting right is that each is a SINGLE rep. A heavy set of five entered here makes every weight the coach prescribes too heavy. If you have never tested a true one-rep max, an honest estimate or a blank is better than a guess dressed up as a number — Coach Diaz works the real figure out from what you log, usually within a week.',

    goal: 'What are you training for?',
    goalOptions: {
      learn_the_lifts: 'Learn the lifts properly',
      general_strength: 'Get generally stronger',
      return_from_layoff: 'Come back after time off',
      first_meet: 'Compete in my first meet',
      meet_prep: 'Prepare for a meet — I have competed before',
    },
    competitionDate: 'Competition date',
    daysPerWeek: 'How many days a week can you train?',
    smallestPlate: 'Smallest plate you have (optional)',
    smallestPlatePlaceholder: '2.5',
    smallestPlateHelp:
      'One plate, not a pair. Weight goes on both ends, so this sets the smallest jump you can make. Leave blank if you are not sure.',
    equipment: 'What equipment can you get to?',
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
    progress: 'Progress',
    exerciseLibrary: 'Exercise library',
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
    readBeforeAgreeing: 'Read the {document} before agreeing →',
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
      document: 'Terms of Service',
    },
    ai_processing: {
      label: 'Sending your training data to our AI provider',
      description:
        'Your profile and training history are sent to Anthropic, which runs the AI model that writes your coaching. Without this, Coach cannot generate anything.',
      document: 'AI Processing disclosure',
    },
    health_data_collection: {
      label: 'Storing your injury and health information',
      description:
        'Optional. Lets Coach train you around injuries and enforce the medical-clearance rule. Coach works without it, just more conservatively. Turning this off erases what is already stored.',
      document: 'Consumer Health Data Privacy Policy',
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
  library: {
    title: 'Exercise library',
    subtitle:
      'How each lift is performed, what to look for when it goes wrong, and where to watch it done properly.',
    cues: 'Cues',
    faults: 'Common faults',
    watchDemo: 'Watch the demonstration (leaves Coach Diaz — use Back to return) →',
    videoCredit: 'Opens {source}. We link to the people who made it; we do not host, copy or embed their video.',
    thirdParty: 'the original source',
    empty: 'No exercises have been added yet.',
    filmYourself:
      'Film yourself from the side at hip height. Almost every fault above is obvious on video and invisible from inside the lift.',
  },

  progress: {
    title: 'Progress',
    subtitle:
      'Your heaviest set of each lift, session by session. Missed sets are shown too — a chart that hides them shows an unbroken climb through a stall.',
    empty: 'Nothing logged yet, so there is nothing to chart.',
    logFirst: 'Log your first session →',
    hoverHint: 'Hover a point for the details.',
    chartLabel: '{lift}: heaviest set across {count} sessions',
    forReps: 'for {reps}',
    missed: 'reps not completed',
    keyCompleted: 'Completed',
    keyMissed: 'Missed',
    trendUp: 'Up {change}{units} since your first logged session.',
    trendDown: 'Down {change}{units} since your first logged session. A reset is part of the plan, not a failure.',
    trendFlat: 'Same weight as your first logged session.',
    trendSingle: 'One session logged. The trend appears once there are two.',
    showTable: 'Show the numbers as a table',
    hideTable: 'Hide the table',
    tableCaption: 'The same data as the charts above, as text.',
    colDate: 'Date',
    colLift: 'Lift',
    colWeight: 'Weight',
    colReps: 'Reps',
    colResult: 'Result',
    lift: {
      squat: 'Squat',
      bench: 'Bench press',
      deadlift: 'Deadlift',
      press: 'Overhead press',
    },
  },

  nav: {
    primary: 'Main navigation',
    coach: 'Coach',
    log: 'Log session',
    progress: 'Progress',
    library: 'Library',
    profile: 'Profile',
    data: 'Your data',
    jumpToTop: 'Top',
  },

  egg: {
    trackKicker: 'BONUS ROUND',
    trackTitle: 'Coach Diaz does not quit on people',
    trackBody:
      'Not mid-block, not mid-set, not when the bar is heavy and you are not sure. There is a song about that sort of commitment. He would like you to hear it before your last set.',
    trackCta: 'Play the motivation track ↗',
    versusKicker: 'ROUND 1',
    versusTitle: 'You vs the bar',
    versusBody:
      'The bar has no strategy. It cannot get tired, it cannot get faster, and it will weigh exactly the same tomorrow. That is the whole reason it is beatable. Go and load it.',
    dismiss: 'Back to training',
  },

};
