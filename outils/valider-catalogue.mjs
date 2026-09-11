#!/usr/bin/env node
/**
 * Valide catalogue.json avant publication.
 * Usage : node outils/valider-catalogue.mjs [chemin]
 * Sortie 0 si le catalogue est publiable, 1 sinon.
 */

import { readFileSync } from "node:fs";

const chemin = process.argv[2] || "catalogue.json";
const erreurs = [];
const alertes = [];

function err(m) { erreurs.push(m); }
function alerte(m) { alertes.push(m); }

let cat;
try {
  cat = JSON.parse(readFileSync(chemin, "utf8"));
} catch (e) {
  console.error("JSON invalide : " + e.message);
  console.error("Une virgule en trop ou manquante suffit. Corrigez avant d'enregistrer.");
  process.exit(1);
}

const estTexte = (v) => typeof v === "string" && v.trim().length > 0;
const estEntier = (v) => Number.isInteger(v);

for (const champ of ["version", "dateEffet", "mentionTva"]) {
  if (!estTexte(cat[champ])) err(`Champ racine « ${champ} » manquant ou vide.`);
}
if (!estEntier(cat.prixJour) || cat.prixJour <= 0) err("« prixJour » doit être un entier positif.");
if (!estEntier(cat.validiteJours) || cat.validiteJours <= 0) err("« validiteJours » doit être un entier positif.");
if (!estEntier(cat.delaiReponseHeures) || cat.delaiReponseHeures <= 0) err("« delaiReponseHeures » doit être un entier positif.");
if (typeof cat.tvaApplicable !== "boolean") err("« tvaApplicable » doit valoir true ou false.");
if (!/^\d{4}-\d{2}-\d{2}$/.test(cat.dateEffet || "")) err("« dateEffet » doit être au format AAAA-MM-JJ.");

for (const champ of ["nom", "activite", "email"]) {
  if (!estTexte(cat.prestataire?.[champ])) err(`« prestataire.${champ} » manquant.`);
}

if (!Array.isArray(cat.branches) || cat.branches.length === 0) {
  err("« branches » doit contenir au moins une branche.");
  rendre();
}

const idsBranches = new Set();

for (const b of cat.branches) {
  const ou = `Branche « ${b.id || "sans id"} »`;

  if (!estTexte(b.id)) err(`${ou} : identifiant manquant.`);
  if (idsBranches.has(b.id)) err(`${ou} : identifiant en double.`);
  idsBranches.add(b.id);

  for (const champ of ["titre", "resume"]) {
    if (!estTexte(b[champ])) err(`${ou} : « ${champ} » manquant.`);
  }
  if (typeof b.actif !== "boolean") err(`${ou} : « actif » doit valoir true ou false.`);

  for (const cle of ["socle", "options"]) {
    if (!Array.isArray(b[cle])) err(`${ou} : « ${cle} » doit être un tableau, même vide.`);
  }
  if (!Array.isArray(b.questions)) err(`${ou} : « questions » doit être un tableau, même vide.`);

  if (!b.actif) continue;

  if (!b.variable && (b.socle || []).length === 0) {
    err(`${ou} : branche active sans aucun item, le client verrait un écran vide.`);
  }

  const idsQuestions = new Map();
  for (const q of b.questions || []) {
    if (!estTexte(q.id)) err(`${ou} : une question n'a pas d'identifiant.`);
    if (!estTexte(q.libelle)) err(`${ou} : question « ${q.id} » sans libellé.`);
    if (!Array.isArray(q.choix) || q.choix.length < 2) err(`${ou} : question « ${q.id} » doit offrir au moins deux choix.`);
    idsQuestions.set(q.id, new Set((q.choix || []).map((c) => c.valeur)));
    for (const c of q.choix || []) {
      if (!estTexte(c.valeur) || !estTexte(c.libelle)) err(`${ou} : un choix de « ${q.id} » est incomplet.`);
    }
  }

  const idsItems = new Set();
  const idsOptions = new Set((b.options || []).map((o) => o.id));
  const tousItems = [];

  if (b.variable) {
    const v = b.variable;
    if (!estTexte(v.id) || !estTexte(v.intitule)) err(`${ou} : « variable » incomplète.`);
    if (![v.min, v.max, v.defaut].every(estEntier)) err(`${ou} : min, max et defaut de « variable » doivent être des entiers.`);
    else if (!(v.min <= v.defaut && v.defaut <= v.max)) err(`${ou} : la durée par défaut doit être comprise entre min et max.`);
    if (v.min < 1) err(`${ou} : la durée minimale doit valoir au moins 1 jour.`);
    tousItems.push([v, "variable"]);
  }

  for (const it of b.socle || []) tousItems.push([it, "socle"]);
  for (const it of b.options || []) tousItems.push([it, "option"]);

  for (const [it, nature] of tousItems) {
    const oi = `${ou}, item « ${it.id || "sans id"} » (${nature})`;

    if (!estTexte(it.id)) err(`${oi} : identifiant manquant.`);
    if (idsItems.has(it.id)) err(`${oi} : identifiant en double dans la branche.`);
    idsItems.add(it.id);

    if (!estTexte(it.intitule)) err(`${oi} : intitulé manquant.`);
    if (!estTexte(it.concretement)) err(`${oi} : « concretement » manquant, le client ne saura pas ce qu'il achète.`);

    if (nature !== "variable") {
      if (!estEntier(it.jours) || it.jours < 1) err(`${oi} : « jours » doit être un entier positif.`);
    }
    if (nature === "option" && !estTexte(it.aCocherSi)) {
      err(`${oi} : « aCocherSi » manquant, le client ne saura pas s'il est concerné.`);
    }

    if (!Array.isArray(it.neFaitPas) || it.neFaitPas.length === 0) {
      err(`${oi} : « neFaitPas » vide. C'est ce champ qui vous protège, il ne peut pas rester vide.`);
    }
    for (const cle of ["fait", "neFaitPas", "prerequis"]) {
      if (it[cle] !== undefined && !Array.isArray(it[cle])) err(`${oi} : « ${cle} » doit être un tableau.`);
      for (const t of it[cle] || []) if (!estTexte(t)) err(`${oi} : une entrée de « ${cle} » est vide.`);
    }

    if (it.joursSi) {
      const j = it.joursSi;
      if (!idsQuestions.has(j.question)) err(`${oi} : « joursSi » cite la question « ${j.question} » qui n'existe pas.`);
      else if (!idsQuestions.get(j.question).has(j.valeur)) err(`${oi} : « joursSi » cite la valeur « ${j.valeur} », absente des choix.`);
      if (!estEntier(j.jours) || j.jours < 1) err(`${oi} : « joursSi.jours » doit être un entier positif.`);
      if (!estTexte(it.noteSi)) alerte(`${oi} : durée variable sans « noteSi », le client ne comprendra pas l'écart.`);
    }

    if (it.optionLiee && !idsOptions.has(it.optionLiee)) {
      err(`${oi} : « optionLiee » cite « ${it.optionLiee} » qui n'est pas une option de cette branche.`);
    }
  }

  const maxJours = (b.variable ? b.variable.max : 0)
    + (b.socle || []).reduce((a, i) => a + Math.max(i.jours, i.joursSi?.jours || 0), 0)
    + (b.options || []).reduce((a, i) => a + i.jours, 0);

  const exclusionsMax = new Set();
  for (const [it] of tousItems) for (const t of it.neFaitPas || []) exclusionsMax.add(t);

  if ((b.options || []).length > 5) alerte(`${ou} : ${b.options.length} options. Au delà de 5, le client arbitre au lieu de choisir.`);
  if (exclusionsMax.size > 12) alerte(`${ou} : ${exclusionsMax.size} exclusions si tout est coché. Trop long pour être lu, regroupez.`);

  console.log(`${ou} : ${tousItems.length} items, jusqu'à ${maxJours} jours soit ${(maxJours * cat.prixJour).toLocaleString("fr-FR")} €, ${exclusionsMax.size} exclusions au maximum.`);
}

rendre();

function rendre() {
  if (alertes.length) {
    console.log("");
    for (const a of alertes) console.log("Alerte : " + a);
  }
  if (erreurs.length) {
    console.log("");
    for (const e of erreurs) console.error("Erreur : " + e);
    console.error(`\n${erreurs.length} erreur(s). Le catalogue n'est pas publiable en l'état.`);
    process.exit(1);
  }
  console.log("\nCatalogue valide, publiable.");
  process.exit(0);
}
