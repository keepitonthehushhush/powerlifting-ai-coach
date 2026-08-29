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
    forYourClinician: 'Information for your doctor or physical therapist',
    faq: 'Questions people ask',
    loading: 'Loading…',
    saving: 'Saving…',
    working: 'Working…',
    signOut: 'Sign out',
    language: 'Language',
  },

  medical: {
    disclaimer:
      'Coach is an AI tool, not a medical professional. If you have current pain, an injury, or a health condition, get clearance from a doctor or physical therapist before training.',
  },

  /**
   * The public front door.
   *
   * Translated, unlike the FAQ and the policy pages, because this is shell
   * rather than long prose: short strings, high visibility, and the first
   * thing anybody sees. A Spanish-speaking visitor who lands on an English
   * headline has already decided something about the product before they find
   * the language switcher.
   *
   * Every claim here is a claim the FAQ or a policy document already makes, in
   * the same strength. server/test/landing.test.js holds them together.
   */
  home: {
    headline: 'A strength coach that reads what you actually lifted.',
    subhead:
      'Coach Diaz writes you a powerlifting program, then rebuilds it from the sessions you log — not from the sessions the plan assumed you would have.',
    ctaCreate: 'Create your account',
    ctaOpen: 'Open your coach',
    ctaSignIn: 'Already have an account? Sign in',
    free: 'Free while it is being built and tested.',

    howTitle: 'How it works',
    step1Title: 'Tell it where you are',
    step1Body:
      'How long you have been training, what your best lifts are, how many days a week you can get to a gym, and what that gym actually has in it.',
    step2Title: 'Get a program, not a template',
    step2Body:
      'Specific lifts, specific weights, specific rest between sets. Those numbers are worked out in ordinary code and handed to the coach as answers, so they never depend on a language model doing arithmetic.',
    step3Title: 'Log what actually happened',
    step3Body:
      'The good sessions and the bad ones. A missed rep is information rather than a failure — the next block is built out of it.',

    aiTitle: 'Why not just ask a general AI?',
    aiBody:
      'You can, and it will write you something that looks right. It will not remember it next month, and it will never know that you missed the last two reps of every top set. When seven strength-and-conditioning experts scored twelve-week programs from three versions of ChatGPT, one error appeared in all of them: fifteen repetitions at 85% of maximum, a load almost nobody gets past five.',
    aiLink: 'The longer answer, including when a general AI is the better choice',

    gymTitle: 'It asks where you train, and then believes you',
    gymBody:
      'A program that assumes a competition bar and a squat rack is useless to somebody with a Smith machine and a pair of dumbbells. Coach Diaz asks where you actually go, and programs for that — including gyms with no barbell at all.',

    honestTitle: 'What it will not do',
    honestDoctor:
      'It is not a doctor. Tell it about pain or an injury and it stops writing programs until you confirm that a doctor or physical therapist has cleared you to train.',
    honestOptional:
      'Every health question is optional. Leave them blank and it simply programs more conservatively.',
    honestAds:
      'It does not sell your data. There are no advertising or analytics scripts anywhere on this site, and no shopping links anywhere in the app.',
    honestDelete:
      'You can delete your account and everything attached to it from the Account page, immediately, without emailing anybody.',

    terms: 'Terms',
    healthPolicy: 'Health data',

    /*
     * FOOTER LABELS ARE SHORT ON PURPOSE, AND SEPARATE FROM THE PAGE ONES.
     *
     * The footer used common.faq ("Questions people ask") and
     * common.forYourClinician ("Information for your doctor or physical
     * therapist") next to "Terms" and "Health data". A full sentence
     * beside a single word does not read as a set, it reads as four things
     * that happened to land there - which is exactly what it looked like.
     *
     * The long labels are right where they are: on a page, in a link somebody
     * reads before deciding to click. In a footer the job is scanning, so the
     * labels are one or two words and parallel in shape. The destinations are
     * unchanged.
     */
    footerNav: 'Site links',
    footerFaq: 'FAQ',
    footerClinicians: 'For clinicians',
  },

  auth: {
    sessionEnded: 'You were signed out and we are not sure why — please sign in again. If this keeps happening, the code in brackets tells us what went wrong.',
    tagline: 'Structured powerlifting programming that adapts to what you actually lift.',
    email: 'Email',
    password: 'Password',
    signIn: 'Sign in',
    createAccount: 'Create account',
    /* One question, one action, as separate strings. The single combined
       string they replaced - "New here? Create an account" - is what made
       three choices read as one line. */
    forgotPrompt: 'Forgot your password?',
    newHerePrompt: 'New here?',
    haveAccountPrompt: 'Already have an account?',
    confirmEmail: 'Check your email to confirm your account, then sign in.',
    captcha: {
      why: 'A quick check that you are not a bot. It usually resolves on its own.',
      blocked:
        'The bot check could not load — an ad blocker, a privacy extension or a network filter may be blocking challenges.cloudflare.com. Allow that address, or try a different browser or network.',
    },
    reset: {
      forgotAction: 'Email me a reset link',
      requestIntro: 'Enter the email address on your account and we will send you a link to set a new password.',
      send: 'Send the reset link',
      sent: 'If an account exists for that address, a reset link is on its way. Check your inbox, and your spam folder.',
      backToSignIn: 'Back to sign in',
      setTitle: 'Choose a new password',
      newPassword: 'New password',
      setPassword: 'Save and sign in',
      linkExpired: 'This reset link is no longer valid.',
      linkExpiredHelp: 'Reset links can only be used once, and they expire. Request a fresh one and use the newest email.',
    },
    passwordRules: {
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
  program: {
    title: 'Your program',
    none: 'Coach has not written you a program yet.',
    askCoach: 'Talk to Coach and ask for one →',
    weekPhase: 'Week {week} · {phase}',
    writtenOn: 'written {date}',
    phases: { novice: 'Novice', intermediate: 'Intermediate', peaking: 'Peaking' },
    movement: 'Movement',
    sets: 'Sets',
    reps: 'Reps',
    weight: 'Weight',
    noWeight: '—',
    logged: 'Logged',
    loggedSince: '{count} session(s) logged since this program was written.',
    alsoLogged: 'Also logged, not in the program: {lifts}.',
    status: {
      done: 'as written',
      changed: 'changed',
      missed: 'not completed',
      not_logged: 'nothing logged',
    },
    supersededNote: 'This is the program Coach most recently wrote you. Ask for changes in the conversation and a new version replaces it here; the old ones are kept below.',
    previous: 'Earlier programs ({count})',
  },
  intake: {
    dateOfBirth: 'Date of birth',
    dateOfBirthHint: 'Used to age-appropriate your programming. Coach Diaz cannot store injury or lifestyle information for under-18s yet, because consent for that has to come from a parent or guardian.',
    pronouns: 'Your pronouns (optional)',
    pronounsPlaceholder: 'e.g. she/her, he/him, they/them',
    pronounsHint:
      'So Coach refers to you correctly. This one is not part of the health-data consent — being addressed properly should not be something you have to trade privacy for.',
    gender: 'Gender (optional)',
    genderHint:
      'Coach uses this for two things only: competition divisions and weight classes are separated by sex in every federation, and the minimum energy intake guidance differs. It never changes how heavy your program is, which exercises you get, or how fast you are expected to progress. It is stored under the health-data consent and you can leave it blank.',
    genderOptions: {
      woman: 'Woman',
      man: 'Man',
      nonbinary: 'Non-binary',
      self_described: 'I would rather describe it myself',
      prefer_not_to_say: 'Prefer not to say',
    },
    genderSelfDescribed: 'How would you describe it?',


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
    glp1: 'Are you using a GLP-1 medication?',
    glp1Help:
      'Optional, and you can skip it. It is asked for one reason: on a GLP-1 a large share of the weight lost is muscle, and lifting is what keeps it — so knowing changes the program. Coach Diaz will never tell you whether to take one. That is between you and your prescriber.',
    glp1Options: {
      none: 'No',
      using: 'Yes, currently',
      considering: 'Thinking about it',
      declined_to_say: 'Prefer not to say',
    },
    goalOptions: {
      learn_the_lifts: 'Learn the lifts properly',
      general_strength: 'Get generally stronger',
      return_from_layoff: 'Come back after time off',
      body_composition: 'Lose fat and keep the muscle I build',
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
    gyms: 'Where do you train?',
    gymsHint:
      'Optional. Checking one fills in the equipment box below with what that chain usually has, so you can correct it instead of writing it from scratch. These are starting points, not facts: no chain publishes what any individual club holds, and they vary a lot between locations.',
    gymOptions: {
      planet_fitness: 'Planet Fitness',
      anytime_fitness: 'Anytime Fitness',
      golds_gym: "Gold's Gym",
      la_fitness: 'LA Fitness',
      crunch: 'Crunch',
      snap_fitness: 'Snap Fitness',
      ymca: 'YMCA',
      university_gym: 'University or college gym',
      barbell_gym: 'Powerlifting or barbell gym',
      home_gym: 'Home gym',
      other: 'Somewhere else',
    },
    gymEquipment: {
      planet_fitness:
        'Planet Fitness: Smith machine, fixed-weight barbells up to about 60lb, dumbbells up to about 50lb, plate-loaded and selectorized machines, cable stations, benches. No Olympic barbell, no squat or power rack, no platform.',
      anytime_fitness:
        'Anytime Fitness: half or full rack, Olympic barbell and plates, Smith machine, flat and adjustable benches, dumbbells, cable and selectorized machines. Deadlift platform only at some locations.',
      golds_gym:
        "Gold's Gym: squat racks and usually a deadlift platform, Olympic barbells and plates, extensive dumbbells, benches, machines. Bumper plates are uncommon. Powdered chalk generally not allowed; some locations permit liquid chalk.",
      la_fitness:
        'LA Fitness: squat racks and usually a deadlift platform, Olympic barbells and plates, dumbbells up to about 120lb, benches, machines. Chalk generally allowed.',
      crunch:
        'Crunch: Olympic barbells and plates, squat racks, benches, a full dumbbell range, machines. Some locations have an Olympic half-rack platform.',
      snap_fitness:
        'Snap Fitness: squat rack at most locations, Olympic barbell and plates, bench stations, dumbbells up to about 100lb, machines. Small-format clubs vary a lot; chalk policy is up to the location.',
      ymca:
        'YMCA: varies a lot between branches. Many have a rack, an Olympic barbell and benches; some are machines and dumbbells only.',
      university_gym:
        'University or college gym: usually several racks and platforms, Olympic barbells and bumper plates, benches, dumbbells, machines.',
      barbell_gym:
        'Powerlifting or barbell gym: competition racks and platforms, competition bars, calibrated or bumper plates, competition bench, chalk, specialty bars.',
    },
    gymLabel: 'Which one? (optional)',
    gymLabelPlaceholder: 'e.g. the one on Kietzke Lane',
    gymLabelHint:
      'Just a note to yourself, so you know which club you meant. It is stored as you type it — there is no address lookup, no map and no location tracking anywhere in this app.',
    equipmentHint:
      'This is the answer your program is built from, so it is worth correcting. Delete anything your gym does not actually have and add anything it does.',

    equipmentPlaceholder: 'Full commercial gym; barbell, rack, bench, plates to 405…',
    healthLegend: 'Injuries, pain, or medical conditions',
    healthNote:
      'Coach needs this to train you safely. It is visible only to your account and is never written to application logs or error reports. Leave blank if none.',
    healthPlaceholder: 'e.g. left shoulder pain when benching; disc issue diagnosed 2023',
    clearedLabel: 'A doctor or physical therapist has cleared me to train with this condition.',
    clearanceWarning:
      'Coach will not write you a program until you have been cleared by a professional. It will still answer questions in the meantime.',
    missingTitle: 'Not saved yet — some answers are still needed',
    missingHint: 'Coach needs these to write you a program. Press one to go straight to it.',
    submit: 'Save and talk to Coach',
    loadFailed: 'Could not load your profile.',
  },

  chat: {
    characterCount: '{count} of {limit} characters',
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
    staleExplained:
      'We have updated this policy, so we are asking again. You agreed to version {oldVersion} on {date}; the current version is {newVersion}. Your previous agreement has not been deleted — it stays in your consent history — but it no longer counts, because it was agreement to wording we have since changed. The box above is empty on purpose: checking it is a fresh decision, and leaving it empty is a valid answer.',
    staleVersion: 'This policy has been updated since you agreed. Please review and confirm again.',
    healthDataCleared:
      'Consent withdrawn. The injury and health information we had stored has been erased.',
    terms_of_service: {
      label: 'Terms of service',
      description: 'The agreement covering your use of Coach, including the training-risk acknowledgment.',
      document: 'Terms of Service',
    },
    ai_processing: {
      label: 'Sending your training data to our AI provider',
      description:
        'Your profile and training history are sent to Anthropic, which runs the AI model that writes your coaching. Without this, Coach cannot generate anything.',
      document: 'AI Processing disclosure',
    },
    leaderboard_publication: {
      label: 'Showing your lifts on the leaderboard',
      description:
        'Optional, and off unless you turn it on. Publishes your display name and your best squat, bench and deadlift to other signed-in users — nothing else, and never your bodyweight, age or health information. Turning it off deletes your entry immediately.',
      document: 'leaderboard page',
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
  },
  billing: {
    title: 'Subscription',
    offerBody:
      'Coaching conversations are part of the subscription — free for 14 days, then $9.99 a month. Cancel any time, and during the trial you are charged nothing at all.',
    lapsedBody:
      'Your subscription has ended, so the coaching conversations are paused. Everything you logged is still here.',
    staysFree:
      'Logging your sessions, your charts, your program and the exercise library stay free, and always will.',
    promisedFree:
      'Your coaching is free, permanently. You signed up while Coach Diaz was still being built and tested, when it was free — that promise stands, and there is nothing for you to pay.',
    promisedFreeSubscribed:
      'You also have a subscription. It is not buying you anything you do not already have, so cancel it whenever you like and nothing about your account changes.',
    subscribe: 'Subscribe',
    resubscribe: 'Restart my subscription',
    manage: 'Manage subscription',
    cancelAnytime:
      'Cancel any time from Manage subscription — no email, no explanation. You keep access until the end of the period you have paid for.',
    renewsOn: 'Active. Renews on {date}.',
    endsOn: 'Canceled. You keep full access until {date}, and nothing is deleted.',
    paymentFailing:
      'A renewal payment did not go through, so your card may need updating. Your coaching is still on while the bank retries — this is a heads-up, not a lock-out.',
    settling: 'Payment received. Setting up your subscription…',
    settlingSlow:
      'Your payment went through. The account has not caught up yet, which occasionally takes a minute — refresh this page shortly and it will be active. Nothing has gone wrong and you have not been charged twice.',
    checkoutCancelled: 'No payment was taken. You can subscribe whenever you like.',
    noRedirect: 'Could not open the payment page. Please try again.',
  },
  leaderboard: {
    title: 'Leaderboard',
    intro:
      'Opt in to compare your best lifts with other people using Coach Diaz. It is off unless you turn it on, and you can leave whenever you like.',
    whatIsShown:
      'If you join, other signed-in lifters see your display name and your best squat, bench and deadlift — nothing else. Not your bodyweight, not your age, not your injuries or health information, not your email. Those never leave your account.',
    agree:
      'I agree that my display name and my best squat, bench and deadlift may be shown to other signed-in users. I can withdraw this at any time, and it deletes my entry.',
    consentRecorded: 'Your agreement to publish is recorded in your consent history.',
    consentWhere: 'See your privacy choices',
    handleLabel: 'Your display name',
    handlePlaceholder: 'e.g. eddy_lifts',
    handleHelp:
      'Three to twenty-four characters: letters, numbers, underscores and hyphens. This is what other lifters see — do not use your real name unless you want to.',
    join: 'Join the leaderboard',
    leave: 'Leave the leaderboard',
    leaveIsDelete:
      'Leaving deletes your leaderboard entry rather than hiding it. Your own logs and program are untouched.',
    loggedOnly:
      'Numbers come from sessions you logged and completed — they cannot be typed in, and a missed rep does not count.',
    empty: 'Nobody has logged that lift yet.',
    rank: '#',
    lifter: 'Lifter',
    best: 'Best',
    thatsYou: '(you)',
    converted: '(logged as {weight} {units})',
    lift: { squat: 'Squat', bench: 'Bench', deadlift: 'Deadlift' },
  },
  achievements: {
    title: 'What you have done',
    private: 'Only you can see these. They are never shown on the leaderboard.',
    none: 'Log a session and the first one appears here.',
    noStreaks:
      'There are deliberately no streaks here. A streak tells you to train tomorrow whatever happened today, and that is how people train on a tweaked back or skip the deload their program called for. Showing up over a month counts. A week off does not undo anything.',
    milestone: '{weight} {units} {lift}',
    cameBack: 'Back after {days} days',
    name: {
      first_session: 'First session logged',
      consistent_month: 'Eight sessions in a month',
      honest_log: 'Logged a miss',
      all_three: 'All three lifts logged',
    },
  },
  activity: {
    title: 'Activity on your account',
    intro:
      'Operations we recorded, so you can check them rather than take our word for it. This does not include your training — only things done to the account itself.',
    byStripe: 'from Stripe',
    action: {
      data_exported: 'You downloaded your data',
      account_deleted: 'Account deletion requested',
      subscription_changed: 'Subscription status changed',
    },
  },
  version: {
    updated:
      'A newer version of Coach Diaz is available. This tab is still running the older one, which can behave oddly until you reload.',
    reload: 'Reload now',
    later: 'Not now',
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
    program: 'Program',
    log: 'Log session',
    progress: 'Progress',
    library: 'Library',
    profile: 'Profile',
    leaderboard: 'Leaderboard',
    data: 'Your data',
    faq: 'FAQ',
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
