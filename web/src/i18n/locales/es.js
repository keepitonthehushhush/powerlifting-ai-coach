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
    appName: 'Coach',
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
  },

  intake: {
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
    squat: 'Sentadilla',
    bench: 'Press banca',
    deadlift: 'Peso muerto',
    goal: 'Objetivo',
    goalOptions: {
      general_strength: 'Ganar fuerza general',
      meet_prep: 'Competir en powerlifting',
    },
    competitionDate: 'Fecha de competición',
    daysPerWeek: 'Días por semana que puedes entrenar',
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
    editProfile: 'Editar perfil',
    emptyPrompt:
      'Saluda y Coach continuará desde ahí — te preguntará lo que necesite antes de escribir nada.',
    you: 'Tú',
    coach: 'Coach',
    thinking: 'Pensando…',
    placeholder: '¿Cómo fue esa sesión?',
    send: 'Enviar',
    inputLabel: 'Escribir a Coach',
    loadFailed: 'No se pudo cargar tu conversación.',
    rateLimited: 'Has enviado muchos mensajes recientemente. Inténtalo de nuevo en un momento.',
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
