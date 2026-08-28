/**
 * Spanish catalogue.
 *
 * Translated with the domain in mind rather than word-for-word: powerlifting
 * terminology is largely borrowed in Spanish-speaking gyms ("press banca",
 * "peso muerto", "sentadilla"), and RPE is used untranslated. Where a literal
 * translation would read as textbook Spanish rather than gym Spanish, the gym
 * usage wins.
 *
 * This should be reviewed by a native speaker before it ships to real users —
 * flagged rather than presented as finished.
 */
export const es = {
  common: {
    backToTop: 'Volver arriba',
    appName: 'Coach Diaz',
    forYourClinician: 'Información para tu médico o fisioterapeuta',
    faq: 'Preguntas frecuentes',
    loading: 'Cargando…',
    saving: 'Guardando…',
    working: 'Procesando…',
    signOut: 'Cerrar sesión',
    language: 'Idioma',
    somethingWentWrong: 'Algo salió mal.',
  },

  medical: {
    disclaimer:
      'Coach es una herramienta de IA, no un profesional médico. Si tienes dolor, una lesión o una condición de salud, consulta con un médico o fisioterapeuta antes de entrenar.',
  },

  auth: {
    sessionEnded: 'Se cerró tu sesión y no sabemos con certeza por qué; vuelve a iniciar sesión. Si sigue pasando, el código entre paréntesis nos dice qué falló.',
    tagline: 'Programación estructurada de powerlifting que se adapta a lo que realmente levantas.',
    email: 'Correo electrónico',
    password: 'Contraseña',
    signIn: 'Iniciar sesión',
    createAccount: 'Crear cuenta',
    toSignIn: '¿Ya tienes cuenta? Inicia sesión',
    toSignUp: '¿Eres nuevo? Crea una cuenta',
    forgotPrompt: '¿Has olvidado tu contraseña?',
    newHerePrompt: '¿Eres nuevo aquí?',
    haveAccountPrompt: '¿Ya tienes una cuenta?',
    confirmEmail: 'Revisa tu correo para confirmar la cuenta y luego inicia sesión.',
    captcha: {
      why: 'Una comprobación rápida de que no eres un bot. Normalmente se resuelve sola.',
      blocked:
        'No se pudo cargar la comprobación antibots: puede que un bloqueador de anuncios, una extensión de privacidad o un filtro de red esté bloqueando challenges.cloudflare.com. Permite esa dirección, o prueba con otro navegador u otra red.',
    },
    reset: {
      forgot: '¿Olvidaste tu contraseña?',
      forgotAction: 'Enviarme un enlace para restablecerla',
      requestTitle: 'Restablecer tu contraseña',
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
    password: {
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
    previous: 'Programas anteriores ({count})',
  },
  intake: {
    dateOfBirth: 'Fecha de nacimiento',
    dateOfBirthHint: 'Se usa para adaptar tu programación a tu edad. Coach Diaz todavía no puede guardar información de lesiones o de estilo de vida de menores de 18 años, porque ese consentimiento tiene que darlo un padre, madre o tutor.',
    pronouns: 'Tus pronombres (opcional)',
    pronounsPlaceholder: 'p. ej. ella, él, elle',
    pronounsHint:
      'Para que el entrenador se dirija a ti correctamente. Esto no forma parte del consentimiento de datos de salud: que te traten bien no debería costarte privacidad.',
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
    goalOptions: {
      learn_the_lifts: 'Aprender bien los levantamientos',
      general_strength: 'Ponerme más fuerte en general',
      return_from_layoff: 'Volver después de un tiempo parado',
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
      'Opcional. Marcar una rellena el cuadro de equipamiento con lo que esa cadena suele tener, para que lo corrijas en vez de escribirlo desde cero. Son puntos de partida, no hechos: ninguna cadena publica lo que tiene cada gimnasio y varían mucho entre ubicaciones.',
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
    missingHint: 'El entrenador las necesita para escribirte un programa. Pulsa una para ir directamente a ella.',
    submit: 'Guardar y hablar con el entrenador',
    loadFailed: 'No se pudo cargar tu perfil.',
  },

  chat: {
    progress: 'Progreso',
    exerciseLibrary: 'Biblioteca de ejercicios',
    characterCount: '{count} de {limit} caracteres',
    logSession: 'Registrar sesión',
    editProfile: 'Editar perfil',
    emptyPrompt:
      'Saluda y Coach Diaz continuará desde ahí — te preguntará lo que necesite antes de escribir nada.',
    you: 'Tú',
    coach: 'Coach',
    thinking: 'Pensando…',
    placeholder: '¿Cómo fue esa sesión?',
    send: 'Enviar',
    inputLabel: 'Escribir a Coach Diaz',
    loadFailed: 'No se pudo cargar tu conversación.',
    rateLimited: 'Has enviado muchos mensajes recientemente. Inténtalo de nuevo en un momento.',
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
    deleteConfirmPrompt: 'Escribe DELETE MY ACCOUNT para confirmar.',
    deleted: 'Tu cuenta y todos los datos asociados se han eliminado permanentemente.',
  },
  billing: {
    title: 'Suscripción',
    offerBody:
      'Las conversaciones con el entrenador forman parte de la suscripción: 9,99 $ al mes, cancela cuando quieras.',
    lapsedBody:
      'Tu suscripción ha terminado, así que las conversaciones con el entrenador están en pausa. Todo lo que registraste sigue aquí.',
    staysFree:
      'Registrar tus sesiones, tus gráficas, tu programa y la biblioteca de ejercicios siguen siendo gratis, y siempre lo serán.',
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
