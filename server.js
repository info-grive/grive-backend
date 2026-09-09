require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const nodemailer = require('nodemailer');
const multer = require('multer');

const app = express();
app.use(cors());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5 Mo par fichier
});

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
});

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT),
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// --- FORMULAIRE CONTACT ---
app.post('/api/contact', upload.array('pieces_jointes', 2), async (req, res) => {
  const { nom, email, phone, societe, localisation, sujet, message } = req.body;

  if (!nom || !email || !message || !sujet) {
    return res.status(400).json({ error: 'Champs requis manquants' });
  }

  try {
    // 1. Sauvegarde en BDD (best-effort : un échec ici n'empêche pas l'email de partir)
    try {
      await pool.query(
        'INSERT INTO soumissions_contact (nom, email, sujet, message, ip_address, consentement_rgpd) VALUES (?, ?, ?, ?, ?, ?)',
        [nom, email, sujet, message, req.ip, true]
      );
    } catch (dbErr) {
      console.error('Sauvegarde BDD échouée (contact), envoi email quand même:', dbErr.message);
    }

    // 2. Envoi email avec pièces jointes
    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: process.env.EMAIL_TO,
      replyTo: email,
      subject: `Nouveau message de contact : ${sujet}`,
      text: `Nom: ${nom}\nEmail: ${email}\nTéléphone: ${phone || 'non renseigné'}\nSociété: ${societe || 'non renseignée'}\nLocalisation: ${localisation || 'non renseignée'}\n\nMessage:\n${message}`,
      attachments: (req.files || []).map(f => ({
        filename: f.originalname,
        content: f.buffer
      }))
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// --- FORMULAIRE RECRUTEMENT ---
app.post('/api/recrutement', upload.fields([
  { name: 'cv', maxCount: 1 },
  { name: 'coverLetter', maxCount: 1 }
]), async (req, res) => {
  const { nom, email, domaine, message } = req.body;
  const cv = req.files?.['cv']?.[0];
  const coverLetter = req.files?.['coverLetter']?.[0];

  if (!nom || !email || !domaine || !cv) {
    return res.status(400).json({ error: 'Champs requis manquants (CV obligatoire)' });
  }

  try {
    // 1. Sauvegarde en BDD (best-effort : un échec ici n'empêche pas l'email de partir)
    try {
      await pool.query(
        'INSERT INTO candidatures_recrutement (nom, email, domaine, message, cv_nom_fichier, lettre_nom_fichier, ip_address, consentement_rgpd) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [nom, email, domaine, message || null, cv.originalname, coverLetter ? coverLetter.originalname : null, req.ip, true]
      );
    } catch (dbErr) {
      console.error('Sauvegarde BDD échouée (recrutement), envoi email quand même:', dbErr.message);
    }

    // 2. Envoi email avec pièces jointes
    const attachments = [{ filename: cv.originalname, content: cv.buffer }];
    if (coverLetter) {
      attachments.push({ filename: coverLetter.originalname, content: coverLetter.buffer });
    }

    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: process.env.EMAIL_TO,
      replyTo: email,
      subject: `Candidature spontanée : ${domaine}`,
      text: `Nom: ${nom}\nEmail: ${email}\nDomaine: ${domaine}\n\nMessage:\n${message || ''}`,
      attachments
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.listen(process.env.PORT, () => {
  console.log(`Backend démarré sur http://localhost:${process.env.PORT}`);
});