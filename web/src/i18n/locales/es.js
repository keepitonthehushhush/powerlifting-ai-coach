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
    backToCoach: 'Volver al entrenador',
    recentTitle: 'Sesiones recientes',
  },
  intake: {
    dateOfBirth: 'Fecha de nacimiento',
    dateOfBirthHint: 'Se usa para adaptar tu programación a tu edad. Coach Diaz todavía no puede guardar información de lesiones ni de hábitos de menores de 18 años, porque ese consentimiento debe darlo un padre, madre o tutor.',
    recoveryLegend: 'Recuperación y hábitos (opcional)',
    recoveryNote: 'Todos estos campos son opcionales y puedes dejarlos en blanco. Entrenar es solo la mitad de ganar fuerza: esto le dice al entrenador con qué capacidad de recuperación está programando realmente. Nada de esto se juzga, y no cambia si recibes entrenamiento.',
    sleepHours: 'Horas de sueño en una noche normal',
    alcohol: 'Bebidas alcohólicas en una semana normal',
    alcoholHint: 'Una bebida estándar equivale aproximadamente a una cerveza de 350 ml, una copa de vino de 150 ml o un trago de 45 ml.',
    nicotine: 'Consumo de nicotina',
    nicotineNone: 'Ninguno',
    nicotineOccasional: 'Ocasionalmente',
    nicotineDaily: 'A diario',
    preferNotToSay: 'Prefiero no decirlo',
    nutrition: 'Algo sobre cómo comes',
    nutritionPlaceholder: 'Bajando de peso para una categoría, vegetariano, sin desayuno, lo que sea relevante.',
    title: 'Tu perfil de entrenamiento',
    subtitle:
      'Coach usa estos datos para escribir tu programa. Las aproximaciones sirven — se ajusta según lo que registres.',
    experience: 'Experiencia de entrenamiento',
    select: 'Selecciona…',
    experienceOptions: {
      never_trained: 'Nunca he entrenado con barra',
      some_experience: 'Algo de experiencia, sin constancia actual',
      currently_training: 'Entrenando de forma constante',
    },
    units: 'Unidades',
    unitOptions: { lb: 'Libras (lb)', kg: 'Kilogramos (kg)' },
    bodyweight: 'Peso corporal',
    squat: 'Sentadilla — mejor levantamiento único',
    bench: 'Press banca — mejor levantamiento único',
    deadlift: 'Peso muerto — mejor levantamiento único',
    liftsNote:
      'El peso máximo que has levantado en una sola repetición de cada uno: tu máximo de una repetición. Si nunca has probado un máximo real, pon tu mejor estimación o déjalo en blanco; Coach Diaz lo deducirá de lo que registres. Lo importante es no poner un peso que hiciste para varias repeticiones: tu programación se calcula a partir de estos números, así que una serie de cinco puesta como máximo hace que todos los pesos prescritos sean demasiado altos.',
    goal: 'Objetivo',
    goalOptions: {
      general_strength: 'Ganar fuerza general',
      meet_prep: 'Competir en powerlifting',
    },
    competitionDate: 'Fecha de competición',
    daysPerWeek: 'Días por semana que puedes entrenar',
    smallestPlate: 'Disco más pequeño que tienes (opcional)',
    smallestPlatePlaceholder: '1.25',
    smallestPlateHelp:
      'Un disco, no un par. El peso va en los dos extremos, así que esto determina el salto más pequeño que puedes hacer. Déjalo en blanco si no estás seguro.',
    equipment: 'Equipamiento disponible',
    equipmentPlaceholder: 'Gimnasio completo; barra, rack, banco, discos hasta 180 kg…',
    healthLegend: 'Lesiones, dolor o condiciones médicas',
    healthNote:
      'Coach necesita esta información para entrenarte de forma segura. Solo es visible desde tu cuenta y nunca se escribe en registros de la aplicación ni en informes de error. Déjalo en blanco si no aplica.',
    healthPlaceholder: 'p. ej. dolor en el hombro izquierdo al hacer press; hernia discal diagnosticada en 2023',
    clearedLabel: 'Un médico o fisioterapeuta me ha autorizado a entrenar con esta condición.',
    clearanceWarning:
      'Coach no te escribirá un programa hasta que un profesional te autorice. Mientras tanto seguirá respondiendo preguntas.',
    submit: 'Guardar y hablar con Coach',
    loadFailed: 'No se pudo cargar tu perfil.',
  },

  chat: {
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
    },
    ai_processing: {
      label: 'Enviar tus datos de entrenamiento a nuestro proveedor de IA',
      description:
        'Tu perfil e historial de entrenamiento se envían a Anthropic, que opera el modelo de IA que escribe tu programación. Sin esto, Coach no puede generar nada.',
    },
    health_data_collection: {
      label: 'Guardar tu información sobre lesiones y salud',
      description:
        'Opcional. Permite que Coach entrene teniendo en cuenta tus lesiones y aplique la norma de autorización médica. Coach funciona sin ello, solo de forma más conservadora. Desactivarlo elimina lo ya guardado.',
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
};
