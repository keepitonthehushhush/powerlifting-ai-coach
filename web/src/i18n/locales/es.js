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
    confirmEmail: 'Revisa tu correo para confirmar la cuenta y luego inicia sesión.',
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
  intake: {
    dateOfBirth: 'Fecha de nacimiento',
    dateOfBirthHint: 'Se usa para adaptar tu programación a tu edad. Coach Diaz todavía no puede guardar información de lesiones o de estilo de vida de menores de 18 años, porque ese consentimiento tiene que darlo un padre, madre o tutor.',

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
    equipmentPlaceholder: 'Gimnasio completo; barra, rack, banco, discos hasta 185 kg…',
    healthLegend: 'Lesiones, dolor o condiciones médicas',
    healthNote:
      'El entrenador necesita esto para entrenarte con seguridad. Solo es visible desde tu cuenta y nunca se escribe en los registros de la aplicación ni en los informes de errores. Déjalo en blanco si no hay nada.',
    healthPlaceholder: 'p. ej. dolor en el hombro izquierdo al hacer banca; problema de disco diagnosticado en 2023',
    clearedLabel: 'Un médico o fisioterapeuta me ha dado el alta para entrenar con esta condición.',
    clearanceWarning:
      'El entrenador no te escribirá un programa hasta que un profesional te haya dado el alta. Mientras tanto seguirá respondiendo preguntas.',
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
    log: 'Registrar sesión',
    progress: 'Progreso',
    library: 'Biblioteca',
    profile: 'Perfil',
    data: 'Tus datos',
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
