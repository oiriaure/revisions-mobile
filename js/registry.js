/* ------------------------------------------------------------------
   Registre des profils et des matières.
   Chaque fichier de src/data/ appelle registerSubject({...}).
   Le thème de couleurs de chaque profil est défini dans styles.css
   (sélecteur [data-profile="..."]).
------------------------------------------------------------------- */
window.PROFILES = [];

window.SUBJECTS = [];
window.normalizeSubject = function (subject) {
  subject.rappels = subject.rappels || [];
  subject.flash = subject.flash || [];
  subject.qcm = subject.qcm || [];
  return subject;
};
window.registerSubject = function (subject) {
  window.SUBJECTS.push(window.normalizeSubject(subject));
};
