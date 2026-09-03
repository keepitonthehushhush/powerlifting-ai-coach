/**
 * Spanish catalog — MEXICAN SPANISH, for a United States audience.
 *
 * ── THE VARIETY IS A DECISION, NOT A DEFAULT ──────────────────────────────
 *
 * "Spanish" is not one target. This app is run from Michigan for lifters in
 * the United States, where the largest Spanish-speaking population by far is
 * of Mexican origin, so the catalog is written in Mexican Spanish and
 * peninsular vocabulary is a defect here rather than a matter of taste.
 *
 * That has one hard rule and a set of softer ones, and they are different in
 * kind. The hard rule: `coger` is ordinary in Spain and RAE marks sense 31
 * "vulg. ... Méx." — realizar el acto sexual. Shipping it to this audience is
 * not a register slip. The softer ones are register: `pulsar` a button,
 * `rellenar` a form, `introducir` data are all correct Spanish and all read
 * as Spain to a Mexican reader, where `tocar`/`seleccionar`, `llenar` and
 * `ingresar` read as home. server/test/i18n.test.js holds the list.
 *
 * `condición médica` STAYS. It is an anglicism and `afección` is what a
 * peninsular style guide would ask for, and it is also what people actually
 * say in Mexico and in US Spanish. Decided by the person who speaks it, and
 * written down here so it does not get "corrected" by somebody who does not.
 *
 * ── AND THE DOMAIN ────────────────────────────────────────────────────────
 *
 * Translated with the domain in mind rather than word-for-word: powerlifting
 * terminology is largely borrowed in Spanish-speaking gyms ("press banca",
 * "peso muerto", "sentadilla"), and RPE is used untranslated. Where a literal
 * translation would read as textbook Spanish rather than gym Spanish, the gym
 * usage wins.
 *
 * Audited against the English for meaning on 2026-09-01 and swept for
 * peninsular vocabulary. Still not a full native-speaker review: an audit
 * catches a requirement that changed and a word from the wrong country; it
 * does not catch a sentence that is correct and reads like a translation.
 */
export const es = {
  common: {
    backToTop: 'Volver arriba',
    // Dos formas de volver: al lugar de origen, o a la portada cuando no hay
    // origen dentro de la aplicación. Ver components/BackLink.jsx.
    back: 'Volver',
    backHome: 'Volver a Coach Diaz',
    editPrivacyChoices: 'Editar tus opciones de privacidad',
    appName: 'Coach Diaz',
    forYourClinician: 'Información para tu médico o fisioterapeuta',
    faq: 'Preguntas frecuentes',
    loading: 'Cargando…',
    saving: 'Guardando…',
    working: 'Procesando…',
    signOut: 'Cerrar sesión',
    language: 'Idioma',
  },

  mfa: {
    heading: 'Inicio de sesión en dos pasos',
    intro:
      'Pide un código de una aplicación de autenticación además de tu contraseña. Tu historial de entrenamiento y todo lo que le has contado al entrenador sobre tu salud están detrás de esta cuenta, así que vale la pena los seis segundos extra.',
    checking: 'Comprobando…',
    on: 'El inicio de sesión en dos pasos está activado.',
    off: 'El inicio de sesión en dos pasos está desactivado.',
    turnOn: 'Activar el inicio de sesión en dos pasos',
    turnOff: 'Desactivar el inicio de sesión en dos pasos',
    turnOffWarning:
      'Solo puedes hacerlo mientras tengas la sesión iniciada con un código. Si pierdes tu autenticador, nadie en Coach Diaz puede desactivarlo sin comprobar antes tu identidad.',
    step1: 'Abre tu aplicación de autenticación: Google Authenticator, 1Password, Authy o la que uses.',
    step2: 'Escanea el cuadro de abajo, o escribe el código que aparece debajo si lo estás configurando en el mismo teléfono.',
    step3: 'Ingresa los seis dígitos que muestra tu aplicación.',
    orTypeIt: 'O escribe esto en tu aplicación:',
    codeLabel: 'Código de seis dígitos',
    confirm: 'Confirmar',
    cancel: 'Cancelar la configuración',
    verify: 'Verificar',
    verifying: 'Comprobando…',
    codeRejected:
      'Ese código no se aceptó. Los códigos cambian cada treinta segundos: espera al siguiente e inténtalo de nuevo.',
    setupFailed: 'No se pudo iniciar la configuración. Inténtalo de nuevo en un momento.',
    removeFailed: 'No se pudo desactivar. Inténtalo de nuevo en un momento.',
    removed: 'El inicio de sesión en dos pasos está desactivado.',
    enrolledOtherSessionsEnded:
      'El inicio de sesión en dos pasos está activado. Se ha cerrado tu sesión en todos los demás sitios: es deliberado, para que una sesión antigua no pueda saltarse el nuevo paso.',
    challengeHeading: 'Un paso más',
    challengeIntro: 'Ingresa el código de tu aplicación de autenticación para terminar de iniciar sesión.',
    noFactorFound:
      'Tu cuenta espera un código pero no hay ningún autenticador registrado. Cierra sesión y ponte en contacto para resolverlo.',
    lostDevice:
      '¿Perdiste tu autenticador? Cierra sesión y contáctanos: comprobaremos tu identidad antes de desactivarlo.',
  },

  medical: {
    disclaimer:
      'Coach es una herramienta de IA, no un profesional médico. Si tienes dolor, una lesión o una condición de salud, obtén el alta de un médico o fisioterapeuta antes de entrenar.',
  },

  home: {
    headline: 'Un entrenador de fuerza que lee lo que de verdad levantaste.',
    subhead:
      'Coach Diaz te escribe un programa de powerlifting y luego lo rehace a partir de las sesiones que registras, no de las que el plan daba por hechas.',
    ctaCreate: 'Crea tu cuenta',
    ctaOpen: 'Abrir tu entrenador',
    ctaSignIn: '¿Ya tienes cuenta? Inicia sesión',
    free: 'Gratis mientras se construye y se prueba.',

    howTitle: 'Cómo funciona',
    step1Title: 'Cuéntale dónde estás',
    step1Body:
      'Cuánto tiempo llevas entrenando, cuáles son tus mejores levantamientos, cuántos días a la semana puedes ir al gimnasio y qué hay realmente en ese gimnasio.',
    step2Title: 'Recibe un programa, no una plantilla',
    step2Body:
      'Ejercicios concretos, pesos concretos y descansos concretos entre series. Esos números se calculan con código normal y se le entregan al entrenador ya resueltos, así que nunca dependen de que un modelo de lenguaje haga bien las cuentas.',
    step3Title: 'Registra lo que pasó de verdad',
    step3Body:
      'Las buenas sesiones y las malas. Una repetición fallada es información, no un fracaso: el siguiente bloque se construye con ella.',

    aiTitle: '¿Por qué no preguntarle a una IA general?',
    aiBody:
      'Puedes hacerlo, y te escribirá algo que parece correcto. No lo recordará el mes que viene y nunca sabrá que fallaste las dos últimas repeticiones de cada serie pesada. Cuando siete expertos en fuerza y acondicionamiento evaluaron programas de doce semanas escritos por tres versiones de ChatGPT, un mismo error apareció en todas: quince repeticiones al 85% del máximo, una carga con la que casi nadie pasa de cinco.',
    aiLink: 'La respuesta larga, incluido cuándo una IA general es la mejor opción',

    gymTitle: 'Te pregunta dónde entrenas, y luego te cree',
    gymBody:
      'Un programa que da por hecha una barra de competición y un rack no le sirve de nada a quien solo tiene una máquina Smith y un par de mancuernas. Coach Diaz pregunta a dónde vas de verdad y programa para eso, incluidos los gimnasios que no tienen barra.',

    honestTitle: 'Lo que no va a hacer',
    honestDoctor:
      'No es médico. Si le hablas de dolor o de una lesión, deja de escribirte programas hasta que confirmes que un médico o un fisioterapeuta te ha autorizado a entrenar.',
    honestOptional:
      'Todas las preguntas de salud son opcionales. Si las dejas en blanco, simplemente programa de forma más conservadora.',
    honestAds:
      'No vende tus datos. No hay scripts de publicidad ni de analítica en ninguna parte de este sitio, ni enlaces de compra en ninguna parte de la aplicación.',
    honestDelete:
      'Puedes borrar tu cuenta y todo lo asociado a ella desde la página de Cuenta, al instante y sin escribirle a nadie.',

    terms: 'Condiciones',

    privacy: 'Politica de privacidad',
    healthPolicy: 'Datos de salud',

    // Cortas y paralelas, como en inglés: en un pie de página se escanea.
    footerNav: 'Enlaces del sitio',
    footerFaq: 'Preguntas frecuentes',
    footerClinicians: 'Para profesionales sanitarios',
  },

  auth: {
    signedOutRevoked:
      'Tu sesión en este dispositivo ya no es válida, así que se ha cerrado. Es normal justo después de activar el inicio de sesión en dos pasos, que finaliza todas las demás sesiones. Vuelve a iniciar sesión para continuar.',
    signedOutPlain: 'Has cerrado sesión. Vuelve a iniciar sesión para continuar donde lo dejaste.',
    signedOutGeneric: 'Has cerrado sesión. Vuelve a iniciar sesión para continuar donde lo dejaste.',
    tagline: 'Programación estructurada de powerlifting que se adapta a lo que realmente levantas.',
    email: 'Correo electrónico',
    emailCleaned: 'Se elimino un caracter invisible que agrego tu teclado. Se usara la direccion de arriba.',
    emailProblem: {
      empty: 'Escribe tu correo electronico.',
      noAt: 'A esa direccion le falta el signo @.',
      manyAt: 'Esa direccion tiene mas de un signo @.',
      noLocal: 'No hay nada antes del signo @.',
      noDomain: 'No hay nada despues del signo @.',
      noDot: 'La parte despues del @ necesita un punto, como gmail.com.',
      badDot: 'Hay un punto en el lugar equivocado despues del signo @.',
      character:
        'Hay un caracter oculto o inusual en esa direccion ({code}). Borra la direccion y escribela de nuevo en vez de pegarla.',
    },
    password: 'Contraseña',
    signIn: 'Iniciar sesión',
    createAccount: 'Crear cuenta',
    forgotPrompt: '¿Has olvidado tu contraseña?',
    newHerePrompt: '¿Eres nuevo aquí?',
    haveAccountPrompt: '¿Ya tienes una cuenta?',
    confirmEmail: 'Revisa tu correo para confirmar la cuenta y luego inicia sesión.',
    errors: {
      captcha_misconfigured:
        'Lo sentimos: el acceso a las cuentas no está disponible temporalmente por un problema nuestro, no tuyo. Ya nos han avisado. Vuelve a intentarlo en un rato.',
      captcha_unavailable:
        'No se pudo cargar la comprobación antibots, así que no pudimos confirmar que eres una persona. Puede que un bloqueador de anuncios, una extensión de privacidad o un filtro de red esté bloqueando challenges.cloudflare.com. Permite esa dirección, o prueba con otro navegador u otra red.',
      captcha_rejected:
        'La comprobación antibots caducó antes de que enviaras el formulario. Inténtalo una vez más: ya se ha cargado una nueva.',
      invalid_credentials:
        'Ese correo y esa contraseña no coinciden con ninguna cuenta. Revisa ambos, o restablece la contraseña si no estás seguro.',
      email_already_registered:
        'Ya existe una cuenta con ese correo electrónico. Prueba a iniciar sesión, o restablece la contraseña.',
      password_rejected:
        'Esa contraseña fue rechazada. Elige una que cumpla los requisitos indicados arriba.',
      auth_rate_limited:
        'Demasiados intentos en poco tiempo. Espera unos minutos y vuelve a intentarlo: tu cuenta no tiene ningún problema.',
      email_rejected:
        'No se aceptó esa dirección de correo. Compruébala por si hay algún error, o prueba con otra.',
      session_expired:
        'Se cerró tu sesión. Vuelve a iniciar sesión.',
      auth_unexpected:
        'Algo falló por nuestra parte y no pudimos completar la operación. Ya nos han avisado. Vuelve a intentarlo en un rato.',
    },
    captcha: {
      why: 'Una comprobación rápida de que no eres un bot. Normalmente se resuelve sola.',
      blocked:
        'No se pudo cargar la comprobación antibots: puede que un bloqueador de anuncios, una extensión de privacidad o un filtro de red esté bloqueando challenges.cloudflare.com. Permite esa dirección, o prueba con otro navegador u otra red.',
    },
    reset: {
      forgotAction: 'Enviarme un enlace para restablecerla',
      requestIntro: 'Escribe el correo electrónico de tu cuenta y te enviaremos un enlace para elegir una contraseña nueva.',
      send: 'Enviar el enlace',
      sent: 'Si existe una cuenta con esa dirección, el enlace ya va en camino. Revisa tu bandeja de entrada y también la carpeta de spam.',
      backToSignIn: 'Volver a iniciar sesión',
      setTitle: 'Elige una contraseña nueva',
      newPassword: 'Contraseña nueva',
      setPassword: 'Guardar e iniciar sesión',
      linkExpired: 'Este enlace de restablecimiento ya no es válido.',
      linkExpiredHelp: 'Los enlaces solo se pueden usar una vez y caducan. Pide uno nuevo y usa el correo más reciente.',
    },
    passwordRules: {
      met: 'Cumplido',
      notMet: 'Sin cumplir',
      requirements: 'Tu contraseña necesita:',
      length: 'Al menos 12 caracteres',
      lowercase: 'Una letra minúscula',
      uppercase: 'Una letra mayúscula',
      digit: 'Un número',
      symbol: 'Un símbolo, como ! @ # $ %',
      weak: 'Esta contraseña todavía no cumple los requisitos indicados abajo.',
      managerHint: 'Un gestor de contraseñas puede generarla y recordarla por ti.',
      breachChecking: 'Comprobando esta contraseña frente a filtraciones conocidas…',
      breachSafe: 'No aparece en ninguna filtración conocida.',
      breached: 'Esta contraseña ha aparecido en {count} filtraciones de datos conocidas. Elige otra: es de las primeras que probará un atacante.',
      breachedBlocked: 'Esa contraseña aparece en filtraciones de datos conocidas. Elige otra para continuar.',
      breachUnknown: 'No se pudo contactar con el servicio de comprobación, así que esta contraseña no se ha verificado. Puedes continuar igualmente.',
    },
  },

  log: {
    title: 'Registrar una sesión',
    subtitle:
      'Lo que realmente levantaste, no lo que estaba prescrito. Coach Diaz ajusta tu siguiente bloque a partir de esto, así que un mal día honesto es más útil que uno maquillado.',
    date: 'Fecha',
    exercise: 'Movimiento',
    exercisePlaceholder: 'Sentadilla, press banca, peso muerto rumano…',
    exerciseNumber: 'Ejercicio',
    sets: 'Series',
    reps: 'Reps',
    weight: 'Peso',
    rpe: 'RPE',
    completed: 'Completado',
    notCompleted: 'sin completar',
    remove: 'Quitar',
    addExercise: '+ Añadir movimiento',
    notes: 'Notas',
    notesPlaceholder: 'Se sintió pesado, la rodilla izquierda molestó en la última serie, lo corté…',
    submit: 'Guardar sesión',
    needExercise: 'Añade al menos un movimiento antes de guardar.',
    recentTitle: 'Sesiones recientes',
  },
  program: {
    title: 'Tu programa',
    none: 'El entrenador todavía no te ha escrito un programa.',
    askCoach: 'Habla con el entrenador y pídele uno →',
    weekPhase: 'Semana {week} · {phase}',
    writtenOn: 'escrito el {date}',
    phases: { novice: 'Principiante', intermediate: 'Intermedio', peaking: 'Puesta a punto' },
    movement: 'Movimiento',
    sets: 'Series',
    reps: 'Repeticiones',
    weight: 'Peso',
    noWeight: '—',
    logged: 'Registrado',
    loggedSince: '{count} sesión(es) registradas desde que se escribió este programa.',
    alsoLogged: 'También registrado, fuera del programa: {lifts}.',
    status: {
      done: 'tal cual',
      changed: 'modificado',
      missed: 'sin completar',
      not_logged: 'sin registrar',
    },
    supersededNote: 'Este es el programa más reciente que te ha escrito el entrenador. Pide cambios en la conversación y una versión nueva sustituirá a esta; las anteriores se conservan abajo.',
    platesPerSide: '{plates} por lado',
    platesBarLabel: 'Una barra cargada a {weight} {units}: {plates} por lado.',
    platesNotLoadable: 'No se puede armar con tus discos: lo más cercano es {nearest} {units}.',
    platesBarOnly: 'Barra vacía ({weight} {units})',
    platesHeaviest: 'Barra más pesada de hoy · {weight} {units}',
    previous: 'Programas anteriores ({count})',
    warmupHeading: 'Antes de levantar',
    warmupGeneral:
      'De cinco a diez minutos de cardio suave — bicicleta, remo, caminata rápida — hasta que se te suba la respiración y sudes ligeramente.',
    warmupMobility:
      'Movilidad dinámica para las articulaciones que vas a usar en esta sesión: balanceos de pierna, círculos de cadera, sentadillas con tu propio peso hasta la profundidad, aperturas con banda, dislocaciones de hombro. Muévete en todo el rango; no mantengas la posición.',
    warmupRampHeading: 'Sube de peso hasta tu primera serie',
    warmupSet: '{weight} {units} × {reps}',
    warmupBarSet: 'Barra vacía × {reps}',
    warmupElevate:
      'Pon la barra sobre bloques, tapetes o una pila de discos para que empiece más o menos a la altura de un disco grande, y calienta desde ahí. Tu peso de trabajo es más ligero que la carga mínima que deja la barra a su altura normal, así que jalarla desde el suelo significaría empezar varias pulgadas más abajo que el levantamiento mismo.',
    warmupWhy:
      'Tu primera serie de trabajo no debería ser lo primero pesado que hace tu cuerpo. Esto es para llegar listo a levantar bien.',
    warmupStretchHeading: 'Los estiramientos van después, no antes',
    warmupStretchBody:
      'El estiramiento estático — el que se mantiene — va después de entrenar o en su propia sesión. Mantenerlo antes de levantar reduce la fuerza que puedes producir, y mejora tu rango de movimiento igual de bien si lo haces después.',
  },
  guardian: {
    title: 'Un padre, madre o tutor tiene que dar su permiso',
    why: 'Como eres menor de 18 años, Coach Diaz no empezará a entrenarte hasta que un padre, madre o tutor haya leído qué es esto y haya dado su permiso.',
    readIt: 'Lee lo que verán.',
    label: 'Su correo electrónico',
    resendLabel: 'Envíalo a otra dirección, o vuelve a enviarlo',
    placeholder: 'madre@ejemplo.com',
    send: 'Enviarles el enlace',
    resend: 'Volver a enviarlo',
    sending: 'Enviando…',
    sent: 'Enviado. Tienen un enlace para leerlo y decidir; nada cambia hasta que lo hagan.',
    awaiting: 'Enviamos un enlace a',
    awaitingHint: 'No pasa nada hasta que lo abran y decidan. Comprueba que la dirección sea correcta y pídeles que miren en su carpeta de spam.',
    granted: 'Un padre, madre o tutor ha dado su permiso. Ya está todo listo.',
    grantedBy: 'Permiso dado por',
    refused: 'Han dicho que no. Coach Diaz no te entrenará sin su permiso. Si fue un error, puedes volver a enviar el enlace abajo.',
    stale: 'Hemos cambiado lo que pedimos que acepten los tutores, así que tenemos que preguntar otra vez. Envía el enlace abajo.',
  },
  intake: {
    dateOfBirth: 'Fecha de nacimiento',
    dateOfBirthHint: 'Se usa para adaptar tu programación a tu edad. Coach Diaz todavía no puede guardar información de lesiones o de estilo de vida de menores de 18 años, porque ese consentimiento tiene que darlo un padre, madre o tutor.',
    pronouns: 'Tus pronombres (opcional)',
    pronounsPlaceholder: 'p. ej. ella, él, elle',
    pronounsHint:
      'Para que el entrenador se dirija a ti correctamente. Esto no forma parte del consentimiento de datos de salud: que se dirijan a ti correctamente no debería costarte privacidad.',
    gender: 'Género (opcional)',
    genderHint:
      'El entrenador lo usa solo para dos cosas: las categorías de competición y las de peso están separadas por sexo en todas las federaciones, y la recomendación de ingesta mínima de energía difiere. Nunca cambia lo pesado que es tu programa, qué ejercicios haces ni la rapidez con la que se espera que progreses. Se guarda bajo el consentimiento de datos de salud y puedes dejarlo en blanco.',
    genderOptions: {
      woman: 'Mujer',
      man: 'Hombre',
      nonbinary: 'No binario',
      self_described: 'Prefiero describirlo yo',
      prefer_not_to_say: 'Prefiero no decirlo',
    },
    genderSelfDescribed: '¿Cómo lo describirías?',


    aboutYouLegend: 'Sobre ti',
    liftsLegend: 'Tus mejores levantamientos',
    trainingLegend: 'Cómo entrenas',

    recoveryLegend: 'Recuperación y estilo de vida (opcional)',
    recoveryNote: 'Todos los campos de aquí son opcionales y puedes dejar cualquiera en blanco. Entrenar es solo la mitad de ponerse fuerte: esto le dice al entrenador con qué capacidad de recuperación está programando en realidad. Aquí no se juzga nada, y nada de esto cambia si recibes entrenamiento o no.',
    sleepHours: 'Horas de sueño en una noche típica',
    alcohol: 'Bebidas alcohólicas en una semana típica',
    alcoholHint: 'Una bebida estándar es aproximadamente una cerveza de 350 ml, una copa de vino de 150 ml o un chupito de 45 ml.',
    nicotine: 'Consumo de nicotina',
    nicotineNone: 'Ninguno',
    nicotineOccasional: 'Ocasionalmente',
    nicotineDaily: 'A diario',
    preferNotToSay: 'Prefiero no decirlo',
    nutrition: 'Algo sobre cómo comes',
    nutritionPlaceholder: 'Bajando de peso para una categoría, vegetariano, no desayuno, lo que sea relevante.',
    title: 'Tu perfil de entrenamiento',
    subtitle:
      'Coach Diaz usa esto para escribir tu programa. Las aproximaciones valen: se ajusta según lo que registres de verdad.',

    experience: '¿Cuánto tiempo llevas entrenando con barra?',
    experienceHint: 'De forma constante, sin contar los parones largos. Si no estás seguro, redondea hacia abajo.',
    select: 'Selecciona…',
    experienceOptions: {
      never_lifted: 'Nunca he usado una barra',
      learning_lifts: 'He usado una, pero todavía estoy aprendiendo los movimientos',
      under_6_months: 'Menos de 6 meses',
      six_to_24_months: 'Entre 6 meses y 2 años',
      over_2_years: 'Más de 2 años',
    },

    cadence: 'Últimamente, ¿con qué frecuencia has podido añadir peso a la barra?',
    cadenceHint:
      'Lo que recuerdes con sinceridad de los últimos meses. Esto es lo más útil que puedes contarle al entrenador: decide si la programación de aquí todavía encaja contigo, y no hay respuesta incorrecta.',
    cadenceOptions: {
      every_session: 'Casi cada sesión',
      every_week: 'Más o menos una vez por semana',
      every_month_or_slower: 'Una vez al mes o menos',
      stalled: 'Hace tiempo que no sube',
      no_history: 'No he estado entrenando, así que no hay nada con qué comparar',
    },

    units: 'Unidades',
    unitOptions: { lb: 'Libras (lb)', kg: 'Kilogramos (kg)' },
    bodyweight: '¿Cuánto pesas?',
    squat: 'El máximo peso que puedes hacer en SENTADILLA a una repetición',
    bench: 'El máximo peso que puedes hacer en PRESS DE BANCA a una repetición',
    deadlift: 'El máximo peso que puedes hacer en PESO MUERTO a una repetición',
    oneRepHint: 'Una repetición, no una serie. Déjalo en blanco si nunca lo has comprobado.',
    liftsNote:
      'Tu primer programa se calcula a partir de estos tres números, así que lo único importante es que cada uno sea de UNA sola repetición. Una serie pesada de cinco puesta aquí hace que todos los pesos que prescriba el entrenador sean demasiado altos. Si nunca has probado un máximo real a una repetición, una estimación honesta o un hueco en blanco es mejor que una suposición disfrazada de número: Coach Diaz deduce la cifra real de lo que registres, normalmente en una semana.',

    goal: '¿Para qué entrenas?',
    glp1: '¿Estás usando un medicamento GLP-1?',
    glp1Help:
      'Opcional, y puedes saltarlo. Se pregunta por un motivo: con un GLP-1 buena parte del peso que se pierde es músculo, y entrenar con pesas es lo que lo conserva, así que saberlo cambia el programa. Coach Diaz nunca te dirá si debes tomarlo o no. Eso es entre tú y quien te lo receta.',
    glp1Options: {
      none: 'No',
      using: 'Sí, actualmente',
      considering: 'Me lo estoy planteando',
      declined_to_say: 'Prefiero no decirlo',
    },
    goalOptions: {
      learn_the_lifts: 'Aprender bien los levantamientos',
      general_strength: 'Ponerme más fuerte en general',
      return_from_layoff: 'Volver después de un tiempo parado',
      body_composition: 'Perder grasa y conservar el músculo que gane',
      first_meet: 'Competir en mi primera competición',
      meet_prep: 'Preparar una competición: ya he competido antes',
    },
    competitionDate: 'Fecha de la competición',
    daysPerWeek: '¿Cuántos días a la semana puedes entrenar?',
    smallestPlate: 'El disco más pequeño que tienes (opcional)',
    smallestPlatePlaceholder: '2.5',
    smallestPlateHelp:
      'Un disco, no un par. El peso va en los dos extremos, así que esto marca el salto más pequeño que puedes dar. Déjalo en blanco si no estás seguro.',
    equipment: '¿A qué equipamiento tienes acceso?',
    gyms: '¿Dónde entrenas?',
    gymsHint:
      'Opcional. Marcar una llena el cuadro de equipamiento con lo que esa cadena suele tener, para que lo corrijas en vez de escribirlo desde cero. Son puntos de partida, no hechos: ninguna cadena publica lo que tiene cada gimnasio y varían mucho entre ubicaciones.',
    gymOptions: {
      planet_fitness: 'Planet Fitness',
      anytime_fitness: 'Anytime Fitness',
      golds_gym: "Gold's Gym",
      la_fitness: 'LA Fitness',
      crunch: 'Crunch',
      snap_fitness: 'Snap Fitness',
      ymca: 'YMCA',
      university_gym: 'Gimnasio universitario',
      barbell_gym: 'Gimnasio de powerlifting o de barra',
      home_gym: 'Gimnasio en casa',
      other: 'En otro sitio',
    },
    gymEquipment: {
      planet_fitness:
        'Planet Fitness: máquina Smith, barras de peso fijo hasta unas 27 kg, mancuernas hasta unos 23 kg, máquinas de placas y de selector, poleas, bancos. Sin barra olímpica, sin jaula ni rack de sentadilla, sin plataforma.',
      anytime_fitness:
        'Anytime Fitness: half rack o rack completo, barra olímpica y discos, máquina Smith, bancos planos y regulables, mancuernas, poleas y máquinas de selector. Plataforma de peso muerto solo en algunas ubicaciones.',
      golds_gym:
        "Gold's Gym: racks de sentadilla y normalmente plataforma de peso muerto, barras olímpicas y discos, amplia gama de mancuernas, bancos, máquinas. Los discos de goma son poco comunes. El magnesio en polvo no suele permitirse; algunas ubicaciones permiten magnesio líquido.",
      la_fitness:
        'LA Fitness: racks de sentadilla y normalmente plataforma de peso muerto, barras olímpicas y discos, mancuernas hasta unos 54 kg, bancos, máquinas. El magnesio suele permitirse.',
      crunch:
        'Crunch: barras olímpicas y discos, racks de sentadilla, bancos, gama completa de mancuernas, máquinas. Algunas ubicaciones tienen plataforma con half rack olímpico.',
      snap_fitness:
        'Snap Fitness: rack de sentadilla en la mayoría de ubicaciones, barra olímpica y discos, bancos, mancuernas hasta unos 45 kg, máquinas. Los locales pequeños varían mucho; la política de magnesio depende de la ubicación.',
      ymca:
        'YMCA: varía mucho entre sedes. Muchas tienen rack, barra olímpica y bancos; algunas solo máquinas y mancuernas.',
      university_gym:
        'Gimnasio universitario: normalmente varios racks y plataformas, barras olímpicas y discos de goma, bancos, mancuernas, máquinas.',
      barbell_gym:
        'Gimnasio de powerlifting o de barra: racks y plataformas de competición, barras de competición, discos calibrados o de goma, banco de competición, magnesio, barras especiales.',
    },
    gymLabel: '¿Cuál? (opcional)',
    gymLabelPlaceholder: 'p. ej. el de la calle Kietzke',
    gymLabelHint:
      'Solo una nota para ti, para saber a qué gimnasio te referías. Se guarda tal como lo escribes: no hay búsqueda de direcciones, ni mapa, ni seguimiento de ubicación en esta aplicación.',
    equipmentHint:
      'De esta respuesta se construye tu programa, así que merece la pena corregirla. Borra lo que tu gimnasio no tenga y añade lo que sí.',

    equipmentPlaceholder: 'Gimnasio completo; barra, rack, banco, discos hasta 185 kg…',
    healthLegend: 'Lesiones, dolor o condiciones médicas',
    healthNote:
      'El entrenador necesita esto para entrenarte con seguridad. Solo es visible desde tu cuenta y nunca se escribe en los registros de la aplicación ni en los informes de errores. Déjalo en blanco si no hay nada.',
    healthPlaceholder: 'p. ej. dolor en el hombro izquierdo al hacer banca; problema de disco diagnosticado en 2023',
    clearedLabel: 'Un médico o fisioterapeuta me ha dado el alta para entrenar con esta condición.',
    clearanceWarning:
      'El entrenador no te escribirá un programa hasta que un profesional te haya dado el alta. Mientras tanto seguirá respondiendo preguntas.',
    missingTitle: 'Aún no se ha guardado — faltan algunas respuestas',
    missingHint: 'El entrenador las necesita para escribirte un programa. Selecciona una para ir directamente a ella.',
    submit: 'Guardar y hablar con el entrenador',
    loadFailed: 'No se pudo cargar tu perfil.',
  },

  chat: {
    showEarlier: 'Mostrar {count} mensajes anteriores',
    characterCount: '{count} de {limit} caracteres',
    emptyPrompt:
      'Saluda y Coach Diaz continuará desde ahí — te preguntará lo que necesite antes de escribir nada.',
    you: 'Tú',
    coach: 'Coach',
    programSaved: 'La semana {week} está guardada: {days} días, lista para seguir.',
    programSavedLink: 'Abrir tu programa',
    thinking: 'Pensando…',
    thinkingElapsed: 'Escribiendo tu respuesta… {seconds} s',
    thinkingLong: 'Todavía escribiendo. Una semana completa de entrenamiento tarda alrededor de un minuto.',
    sendingUndo: 'Enviando en {seconds}…',
    undo: 'Deshacer',
    undone: 'No se envió. Tu mensaje volvió al cuadro de texto.',
    placeholder: '¿Cómo fue esa sesión?',
    send: 'Enviar',
    inputLabel: 'Escribir a Coach Diaz',
    loadFailed: 'No se pudo cargar tu conversación.',
    rateLimited: 'Has enviado muchos mensajes recientemente. Inténtalo de nuevo en un momento.',
  },

  chatSettings: {
    heading: 'Cómo se comporta la conversación con el coach',
    intro: 'Se guardan solo en este dispositivo, así puedes tener una configuración en el teléfono y otra en la computadora.',
    sendKeyLegend: 'Enviar un mensaje',
    sendKey: {
      enter: 'Enter envía',
      modifier: 'Enter agrega una línea; Cmd o Ctrl + Enter envía',
    },
    sendKeyHint: 'Shift + Enter siempre agrega una línea, en cualquier caso.',
    undoLegend: 'Retener los mensajes antes de enviarlos',
    undoOff: 'Desactivado: enviar de inmediato',
    undoSeconds: '{seconds} segundos para deshacer',
    undoHint: 'Una pausa breve antes de que salga el mensaje, para poder recuperar y corregir un error. No se envía ni se cobra nada hasta que termina la pausa.',
  },

  consent: {
    title: 'Tus opciones de privacidad',
    subtitle:
      'Están separadas a propósito. Puedes cambiar cualquiera más adelante, y desactivar una nunca desactiva otra.',
    required: '(obligatorio)',
    requiredToContinue: 'Debes aceptar las opciones obligatorias antes de continuar.',
    continue: 'Continuar al cuestionario',
    readBeforeAgreeing: 'Lee el {document} antes de aceptar →',
    readPolicy: 'Leer la Política de Privacidad de Datos de Salud',
    withdrawAnytime:
      'Puedes retirar cualquiera de estos permisos cuando quieras desde esta pantalla. Retirarlo es tan fácil como concederlo: un clic, sin correos ni esperas.',
    recordedOn: 'Registrado el {date} (versión {version})',
    staleExplained:
      'Hemos actualizado esta política, así que te lo preguntamos otra vez. Aceptaste la versión {oldVersion} el {date}; la versión actual es {newVersion}. Tu aceptación anterior no se ha borrado (sigue en tu historial de consentimiento), pero ya no cuenta, porque era la aceptación de un texto que hemos cambiado. La casilla de arriba está vacía a propósito: marcarla es una decisión nueva, y dejarla vacía es una respuesta válida.',
    staleVersion: 'Esta política se ha actualizado desde que diste tu consentimiento. Revísala y confírmala de nuevo.',
    healthDataCleared:
      'Consentimiento retirado. La información sobre lesiones y salud que teníamos guardada se ha eliminado.',
    terms_of_service: {
      label: 'Términos del servicio',
      description: 'El acuerdo que regula tu uso de Coach, incluida la aceptación del riesgo del entrenamiento.',
      document: 'Términos del Servicio',
    },
    ai_processing: {
      label: 'Enviar tus datos de entrenamiento a nuestro proveedor de IA',
      description:
        'Tu perfil e historial de entrenamiento se envían a Anthropic, que opera el modelo de IA que escribe tu programación. Sin esto, Coach no puede generar nada.',
      document: 'aviso sobre el procesamiento con IA',
    },
    leaderboard_publication: {
      label: 'Mostrar tus marcas en la clasificación',
      description:
        'Opcional, y desactivado salvo que lo actives. Publica tu nombre público y tus mejores marcas de sentadilla, press de banca y peso muerto para otras personas registradas, y nada más: nunca tu peso corporal, tu edad ni información de salud. Al desactivarlo se borra tu entrada de inmediato.',
      document: 'página de la clasificación',
    },
    health_data_collection: {
      label: 'Guardar tu información sobre lesiones y salud',
      description:
        'Opcional. Permite que Coach entrene teniendo en cuenta tus lesiones y aplique la norma de autorización médica. Coach funciona sin ello, solo de forma más conservadora. Desactivarlo elimina lo ya guardado.',
      document: 'Política de Privacidad de Datos de Salud',
    },
  },

  /*
   * Paquetes de temas. Los nombres describen la paleta, no a quien deberia
   * elegirla - ver la nota en en.js.
   *
   * Los nombres propios de los temas se dejan sin traducir a proposito: son
   * etiquetas de marca, y traducirlas rompe la conversacion entre una persona
   * que dice "estoy usando Cobalt" y otra que busca "Cobalto".
   */
  themes: {
    heading: 'Tema',
    intro: 'Elige como se ve la aplicacion. Tu eleccion te sigue en cualquier dispositivo donde inicies sesion.',
    saving: 'Guardando...',
    saved: 'Guardado',
    failed: 'No se pudo guardar. Lo estas viendo, pero no llego a tu cuenta.',
    names: {
      miami: 'Miami',
      blush: 'Blush',
      cobalt: 'Cobalt',
      ember: 'Ember',
      moss: 'Moss',
      amethyst: 'Amethyst',
      copper: 'Copper',
      slate: 'Slate',
      mono: 'Mono',
      sunrise: 'Sunrise',
    },
    blurbs: {
      miami: 'Turquesa y magenta sobre indigo profundo. El original.',
      blush: 'Rosa calido con acento violeta.',
      cobalt: 'Azul profundo, frio y tranquilo.',
      ember: 'Naranja quemado y rojo.',
      moss: 'Verde bosque con filo lima.',
      amethyst: 'Morado y orquidea.',
      copper: 'Bronce y ambar.',
      slate: 'Gris casi neutro con acento azul.',
      mono: 'Sin color. Contraste maximo.',
      sunrise: 'Oro y arcilla.',
    },
  },
  account: {
    title: 'Tus datos',
    exportHeading: 'Descarga todo lo que guardamos sobre ti',
    exportBody:
      'Una copia legible por máquina de tu perfil, programas, sesiones registradas y conversaciones, incluida la información de salud que proporcionaste.',
    exportButton: 'Descargar mis datos',
    deleteHeading: 'Eliminar tu cuenta',
    deleteBody:
      'Elimina permanentemente tu cuenta y todos los registros asociados — perfil, programas, sesiones, registros de progreso y conversaciones. Esta acción no se puede deshacer.',
    deleteButton: 'Eliminar mi cuenta',
    deleteConfirmPrompt: 'Escribe DELETE MY ACCOUNT (en inglés, tal cual) para confirmar.',
  },
  billing: {
    title: 'Suscripción',
    offerBody:
      'Las conversaciones con el entrenador forman parte de la suscripción: gratis durante 14 días y después 9,99 $ al mes. Cancela cuando quieras; durante la prueba no se te cobra nada.',
    lapsedBody:
      'Tu suscripción ha terminado, así que las conversaciones con el entrenador están en pausa. Todo lo que registraste sigue aquí.',
    staysFree:
      'Registrar tus sesiones, tus gráficas, tu programa y la biblioteca de ejercicios siguen siendo gratis, y siempre lo serán.',
    promisedFree:
      'Tu entrenamiento es gratis, para siempre. Te registraste mientras Coach Diaz aún se estaba construyendo y probando, cuando era gratuito: esa promesa se mantiene, y no tienes nada que pagar.',
    promisedFreeSubscribed:
      'Además tienes una suscripción. No te está dando nada que no tengas ya, así que cancélala cuando quieras y no cambiará nada en tu cuenta.',
    subscribe: 'Suscribirme',
    resubscribe: 'Reactivar mi suscripción',
    manage: 'Gestionar suscripción',
    cancelAnytime:
      'Cancela cuando quieras desde Gestionar suscripción: sin correos y sin dar explicaciones. Conservas el acceso hasta el final del periodo que ya has pagado.',
    renewsOn: 'Activa. Se renueva el {date}.',
    endsOn: 'Cancelada. Conservas el acceso completo hasta el {date}, y no se borra nada.',
    paymentFailing:
      'Un pago de renovación no se completó, así que puede que tengas que actualizar la tarjeta. Tu entrenamiento sigue activo mientras el banco lo reintenta: esto es un aviso, no un bloqueo.',
    settling: 'Pago recibido. Estamos activando tu suscripción…',
    settlingSlow:
      'Tu pago se ha realizado. La cuenta aún no se ha actualizado, algo que a veces tarda un minuto: actualiza esta página en breve y estará activa. No ha fallado nada y no se te ha cobrado dos veces.',
    checkoutCancelled: 'No se ha cobrado nada. Puedes suscribirte cuando quieras.',
    noRedirect: 'No se pudo abrir la página de pago. Inténtalo de nuevo.',
  },
  leaderboard: {
    title: 'Clasificación',
    intro:
      'Únete para comparar tus mejores levantamientos con otras personas que usan Coach Diaz. Está desactivada salvo que la actives, y puedes salir cuando quieras.',
    whatIsShown:
      'Si te unes, otras personas registradas verán tu nombre público y tus mejores marcas de sentadilla, press de banca y peso muerto, y nada más. Ni tu peso corporal, ni tu edad, ni tus lesiones o información de salud, ni tu correo. Eso nunca sale de tu cuenta.',
    agree:
      'Acepto que mi nombre público y mis mejores marcas de sentadilla, press de banca y peso muerto se muestren a otras personas registradas. Puedo retirarlo cuando quiera, y eso borra mi entrada.',
    consentRecorded: 'Tu aceptación para publicar queda registrada en tu historial de consentimiento.',
    consentWhere: 'Ver tus opciones de privacidad',
    handleLabel: 'Tu nombre público',
    handlePlaceholder: 'p. ej. eddy_lifts',
    handleHelp:
      'De tres a veinticuatro caracteres: letras, números, guiones bajos y guiones. Es lo que verán otras personas; no uses tu nombre real salvo que quieras.',
    join: 'Unirme a la clasificación',
    leave: 'Salir de la clasificación',
    leaveIsDelete:
      'Salir borra tu entrada en lugar de ocultarla. Tus registros y tu programa no se tocan.',
    loggedOnly:
      'Los números salen de sesiones que registraste y completaste: no se pueden escribir a mano, y una repetición fallada no cuenta.',
    empty: 'Todavía nadie ha registrado ese levantamiento.',
    rank: '#',
    lifter: 'Atleta',
    best: 'Mejor',
    thatsYou: '(tú)',
    converted: '(registrado como {weight} {units})',
    lift: { squat: 'Sentadilla', bench: 'Press de banca', deadlift: 'Peso muerto' },
  },
  achievements: {
    title: 'Lo que has hecho',
    private: 'Solo tú puedes verlos. Nunca se muestran en la clasificación.',
    none: 'Registra una sesión y aquí aparecerá el primero.',
    noStreaks:
      'Aquí no hay rachas, y es a propósito. Una racha te dice que entrenes mañana pase lo que pase hoy, y así es como la gente entrena con la espalda tocada o se salta la descarga que tocaba. Aparecer a lo largo de un mes cuenta. Una semana de descanso no deshace nada.',
    milestone: '{weight} {units} en {lift}',
    cameBack: 'De vuelta tras {days} días',
    name: {
      first_session: 'Primera sesión registrada',
      consistent_month: 'Ocho sesiones en un mes',
      honest_log: 'Registraste un fallo',
      all_three: 'Los tres levantamientos registrados',
    },
  },
  activity: {
    title: 'Actividad en tu cuenta',
    intro:
      'Operaciones que hemos registrado, para que puedas comprobarlas en lugar de fiarte de nuestra palabra. No incluye tu entrenamiento: solo lo que se hace sobre la cuenta.',
    byStripe: 'desde Stripe',
    action: {
      data_exported: 'Descargaste tus datos',
      account_deleted: 'Se solicitó borrar la cuenta',
      subscription_changed: 'Cambió el estado de la suscripción',
    },
  },
  version: {
    updated:
      'Hay una versión más reciente de Coach Diaz. Esta pestaña sigue usando la anterior, que puede comportarse de forma extraña hasta que la recargues.',
    reload: 'Recargar ahora',
    later: 'Ahora no',
  },
  library: {
    title: 'Biblioteca de ejercicios',
    subtitle:
      'Cómo se ejecuta cada levantamiento, qué buscar cuando sale mal, y dónde verlo hecho correctamente.',
    cues: 'Claves técnicas',
    faults: 'Errores comunes',
    watchDemo: 'Ver la demostración (sales de Coach Diaz — usa Atrás para volver) →',
    videoCredit: 'Abre {source}. Enlazamos a quienes lo crearon; no alojamos, copiamos ni incrustamos su vídeo.',
    thirdParty: 'la fuente original',
    empty: 'Todavía no se han añadido ejercicios.',
    filmYourself:
      'Grábate desde el lateral a la altura de la cadera. Casi todos los errores de arriba son evidentes en vídeo e invisibles desde dentro del levantamiento.',
  },

  progress: {
    title: 'Progreso',
    subtitle:
      'Tu serie más pesada de cada levantamiento, sesión a sesión. También se muestran las series fallidas — un gráfico que las oculta muestra una subida continua a través de un estancamiento.',
    empty: 'Todavía no hay nada registrado, así que no hay nada que graficar.',
    logFirst: 'Registra tu primera sesión →',
    hoverHint: 'Pasa el cursor por un punto para ver los detalles.',
    chartLabel: '{lift}: serie más pesada en {count} sesiones',
    forReps: 'por {reps}',
    missed: 'repeticiones no completadas',
    keyCompleted: 'Completada',
    keyMissed: 'Fallida',
    trendUp: 'Has subido {change}{units} desde tu primera sesión registrada.',
    trendDown: 'Has bajado {change}{units} desde tu primera sesión registrada. Un reinicio es parte del plan, no un fracaso.',
    trendFlat: 'El mismo peso que en tu primera sesión registrada.',
    trendSingle: 'Una sesión registrada. La tendencia aparece cuando haya dos.',
    showTable: 'Ver los números como tabla',
    hideTable: 'Ocultar la tabla',
    tableCaption: 'Los mismos datos de los gráficos anteriores, en texto.',
    colDate: 'Fecha',
    colLift: 'Levantamiento',
    colWeight: 'Peso',
    colReps: 'Repeticiones',
    colResult: 'Resultado',
    e1rmHeading: 'Máximo estimado de una repetición',
    e1rmIntro: 'Lo que cada sesión predice que podrías levantar a una repetición. La banda es el rango entre las dos ecuaciones estándar: muestra que esto es una predicción, no una medición. No es un margen de error.',
    e1rmTitle: '{lift} · máximo estimado',
    e1rmChartLabel: '{lift}: máximo estimado de una repetición, últimamente entre {low} y {high} {units}',
    e1rmLatest: 'Última: {low}–{high} {units}, a partir de {weight} {units} por {reps}.',
    e1rmNone: 'Aún no hay series en un rango del que se pueda estimar. Se usan series de ocho repeticiones o menos.',
    milestoneHeading: 'Tu próxima marca de discos',
    milestoneIntro: 'Lo cerca que está el próximo número redondo, medido desde el último que alcanzaste y no desde cero, porque \'entre dos y tres discos\' es como ya lo piensas.',
    milestoneTo: 'para',
    milestoneFrom: 'Desde {floor} {units}. Mejor hasta ahora {best} {units}.',
    milestoneLabel: 'faltan {remaining} {units} para llegar a {target} {units}',
    milestoneAllDone: 'Ya has superado todas las marcas que seguimos para este levantamiento.',
    milestoneNone: 'Registra una sentadilla, press de banca o peso muerto completado y aquí aparecerá la próxima marca.',
    lift: {
      squat: 'Sentadilla',
      bench: 'Press de banca',
      deadlift: 'Peso muerto',
      press: 'Press militar',
    },
  },

  nav: {
    primary: 'Navegación principal',
    coach: 'Coach',
    program: 'Programa',
    log: 'Registrar sesión',
    progress: 'Progreso',
    library: 'Biblioteca',
    profile: 'Perfil',
    leaderboard: 'Clasificación',
    data: 'Tus datos',
    faq: 'Preguntas frecuentes',
    jumpToTop: 'Arriba',
  },

  egg: {
    trackKicker: 'RONDA EXTRA',
    trackTitle: 'Coach Diaz no abandona a nadie',
    trackBody:
      'Ni a mitad de bloque, ni a mitad de serie, ni cuando la barra pesa y no lo tienes claro. Hay una canción sobre ese tipo de compromiso. Le gustaría que la escucharas antes de tu última serie.',
    trackCta: 'Reproducir la canción ↗',
    versusKicker: 'RONDA 1',
    versusTitle: 'Tú contra la barra',
    versusBody:
      'La barra no tiene estrategia. No se cansa, no se vuelve más rápida, y mañana pesará exactamente lo mismo. Por eso mismo se le puede ganar. Ve a cargarla.',
    dismiss: 'Volver al entrenamiento',
  },

};
