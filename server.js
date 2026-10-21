const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const app = express();
app.use(cors());
app.use(express.json());

let db;

async function initDB() {
  db = await open({
    filename: './ruleta.db',
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS folios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo TEXT UNIQUE NOT NULL,
      usado INTEGER DEFAULT 0,
      giros_restantes INTEGER DEFAULT 1,
      tipo_giro_extra INTEGER DEFAULT 0, -- 0: sin extra, 1: tiene 1 giro extra, 2: tiene 2 giros extras
      premio_asignado TEXT DEFAULT 'Sin asignar',
      premio_ganado TEXT,
      fecha_uso DATETIME
    );
  `);
  console.log('Base de datos inicializada correctamente');
}

const SECCIONES = [
  { id: 1, premio: "$300 pesos", esPremio: true, color: "#FF4D4D" },
  { id: 2, premio: "$150 pesos", esPremio: true, color: "#4DA6FF" },
  { id: 3, premio: "$100 pesos", esPremio: true, color: "#FFD700" },
  { id: 4, premio: "$50 pesos",  esPremio: true, color: "#4DFF88" },
  { id: 5, premio: "Bono de $20 pesos",  esPremio: true, color: "#9b59b6" },
  { id: 6, premio: "1 Giro Extra", esPremio: false, esGiroExtra: true, color: "#ff8c00" },
  { id: 7, premio: "2 Giros Extras", esPremio: false, esGiroExtra: true, color: "#e67e22" },
  { id: 8, premio: "Suerte para la próxima", esPremio: false, color: "#CCCCCC" }
];

const PREMIOS_CONFIG = [
  { premio: "$300 pesos", cantidad: 1 },
  { premio: "$150 pesos", cantidad: 1 },
  { premio: "$100 pesos", cantidad: 1 },
  { premio: "$50 pesos",  cantidad: 4 },
  { premio: "Bono de $20 pesos",  cantidad: 25 },
  { premio: "Suerte para la próxima", cantidad: 67 }
];

// Función principal para iniciar la base de datos y levantar el servidor ordenadamente
async function main() {
  try {
    await initDB();

    const PORT = process.env.PORT || 3001;
    app.listen(PORT, () => {
      console.log(`Servidor Backend corriendo en el puerto ${PORT}`);
    });
  } catch (error) {
    console.error('Error al iniciar la aplicación:', error);
    process.exit(1);
  }
}

main();

function generarCodigo5() {
  const caracteres = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let resultado = '';
  for (let i = 0; i < 5; i++) {
    resultado += caracteres.charAt(Math.floor(Math.random() * caracteres.length));
  }
  return resultado;
}

app.get('/api/ruleta-config', (req, res) => {
  res.json({ secciones: SECCIONES });
});

app.post('/api/girar', async (req, res) => {
  const { codigo } = req.body;
  const codigoLimpio = codigo ? codigo.trim().toUpperCase() : "";

  if (!codigoLimpio) {
    return res.status(400).json({ error: "Ingresa un folio de participación válido." });
  }

  try {
    const folioReg = await db.get('SELECT * FROM folios WHERE codigo = ?', [codigoLimpio]);

    if (!folioReg) {
      return res.status(404).json({ error: "El folio ingresado NO es válido o no está registrado." });
    }

    if (folioReg.premio_asignado === 'Sin asignar' || !folioReg.premio_asignado) {
      return res.status(400).json({ error: "Este folio aún no tiene un premio asignado por el administrador." });
    }

    if (folioReg.usado === 1 && folioReg.giros_restantes <= 0) {
      return res.status(400).json({ 
        error: `Este folio ya agotó todos sus giros el ${folioReg.fecha_uso}.` 
      });
    }

    let indiceGanador;
    let nuevosGirosRestantes = folioReg.giros_restantes;

    // CASO 1: Si tiene 2 giros extras pendientes (es su primer tiro)
    if (folioReg.tipo_giro_extra === 2 && folioReg.giros_restantes === 3) {
      indiceGanador = SECCIONES.findIndex(s => s.premio === "2 Giros Extras");
      nuevosGirosRestantes = 2; // Quedan 2 giros por delante

      await db.run('UPDATE folios SET giros_restantes = ? WHERE id = ?', [nuevosGirosRestantes, folioReg.id]);

      return res.json({
        exito: true,
        indiceGanador: indiceGanador >= 0 ? indiceGanador : 6,
        resultado: SECCIONES[indiceGanador >= 0 ? indiceGanador : 6],
        girosRestantes: nuevosGirosRestantes,
        esUltimoGiro: false,
        mensaje: "¡Felicidades! Caíste en 2 Giros Extras. ¡Presiona el botón para girar de nuevo!"
      });
    }

    // CASO 2: Si está gastando el primer giro extra de esos 2 (debe caer en "Suerte para la próxima")
    else if (folioReg.tipo_giro_extra === 2 && folioReg.giros_restantes === 2) {
      indiceGanador = SECCIONES.findIndex(s => s.premio === "Suerte para la próxima");
      nuevosGirosRestantes = 1; // Queda 1 tiro final

      await db.run('UPDATE folios SET giros_restantes = ? WHERE id = ?', [nuevosGirosRestantes, folioReg.id]);

      return res.json({
        exito: true,
        indiceGanador: indiceGanador >= 0 ? indiceGanador : 7,
        resultado: SECCIONES[indiceGanador >= 0 ? indiceGanador : 7],
        girosRestantes: nuevosGirosRestantes,
        esUltimoGiro: false,
        mensaje: "¡Cerca!. ¡Te queda tu último giro extra, presiona el botón!"
      });
    }

    // CASO 3: Si tiene 1 giro extra pendiente (es su primer tiro y cae en "1 Giro Extra")
    else if (folioReg.tipo_giro_extra === 1 && folioReg.giros_restantes === 2) {
      indiceGanador = SECCIONES.findIndex(s => s.premio === "1 Giro Extra");
      nuevosGirosRestantes = 1; // Queda 1 tiro final

      await db.run('UPDATE folios SET giros_restantes = ? WHERE id = ?', [nuevosGirosRestantes, folioReg.id]);

      return res.json({
        exito: true,
        indiceGanador: indiceGanador >= 0 ? indiceGanador : 5,
        resultado: SECCIONES[indiceGanador >= 0 ? indiceGanador : 5],
        girosRestantes: nuevosGirosRestantes,
        esUltimoGiro: false,
        mensaje: "¡Felicidades! Ganaste 1 Giro Extra. ¡Presiona el botón para girar de nuevo!"
      });
    }

    // CASO 4: Es su tiro definitivo (Premio real asignado o Suerte final)
    else {
      const premioAsignadoTexto = folioReg.premio_asignado;
      indiceGanador = SECCIONES.findIndex(s => s.premio === premioAsignadoTexto);
      if (indiceGanador === -1) indiceGanador = 7;

      const resultado = SECCIONES[indiceGanador];

      // Generación exacta de la hora local de Sonora usando zona horaria con formato numérico seguro
      const fechaLocalObj = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Hermosillo" }));
      const dia = String(fechaLocalObj.getDate()).padStart(2, '0');
      const mes = String(fechaLocalObj.getMonth() + 1).padStart(2, '0');
      const anio = fechaLocalObj.getFullYear();
      
      let hora24 = fechaLocalObj.getHours();
      const minutos = String(fechaLocalObj.getMinutes()).padStart(2, '0');
      const segundos = String(fechaLocalObj.getSeconds()).padStart(2, '0');
      
      const ampm = hora24 >= 12 ? 'p. m.' : 'a. m.';
      let hora12 = hora24 % 12;
      hora12 = hora12 ? hora12 : 12; // Si es 0 se convierte en 12
      const horaStr = String(hora12).padStart(2, '0');

      const fechaHoraLocal = `${dia}/${mes}/${anio}, ${horaStr}:${minutos}:${segundos} ${ampm}`;

      await db.run(
        'UPDATE folios SET usado = 1, giros_restantes = 0, premio_ganado = ?, fecha_uso = ? WHERE id = ?',
        [resultado.premio, fechaHoraLocal, folioReg.id]
      );

      return res.json({
        exito: true,
        indiceGanador,
        resultado,
        girosRestantes: 0,
        esUltimoGiro: true,
        fechaUso: fechaHoraLocal, // <-- Agregado para que el botón de WhatsApp reciba la hora exacta
        mensaje: resultado.esPremio 
          ? `¡Felicidades! Ganaste: ${resultado.premio}` 
          : "Gracias por participar. ¡Suerte para la próxima!"
      });
    }

  } catch (error) {
    console.error("Error al procesar el giro:", error);
    res.status(500).json({ error: "Error en el servidor." });
  }
});

app.get('/api/admin/folios', async (req, res) => {
  try {
    const folios = await db.all('SELECT * FROM folios ORDER BY id DESC');
    res.json({ folios });
  } catch (err) {
    res.status(500).json({ error: "Error al consultar folios." });
  }
});

app.post('/api/admin/folios', async (req, res) => {
  const { codigos } = req.body;
  if (!codigos || !Array.isArray(codigos) || codigos.length === 0) {
    return res.status(400).json({ error: "Proporciona una lista de folios válida." });
  }

  let agregados = 0;
  for (let c of codigos) {
    const limpio = c.trim().toUpperCase();
    if (limpio) {
      try {
        await db.run('INSERT INTO folios (codigo, premio_asignado) VALUES (?, ?)', [limpio, "Suerte para la próxima"]);
        agregados++;
      } catch (err) {}
    }
  }
  res.json({ exito: true, agregados });
});

app.post('/api/admin/generar-aleatorios', async (req, res) => {
  try {
    await db.run('DELETE FROM folios');

    let codigosUnicos = new Set();
    while (codigosUnicos.size < 100) {
      codigosUnicos.add(generarCodigo5());
    }

    for (let codigo of codigosUnicos) {
      await db.run('INSERT INTO folios (codigo, premio_asignado, giros_restantes, tipo_giro_extra) VALUES (?, ?, 1, 0)', [codigo, 'Sin asignar']);
    }

    res.json({ exito: true, creados: 100 });
  } catch (err) {
    console.error("Error al generar aleatorios:", err);
    res.status(500).json({ error: "Error al generar folios aleatorios." });
  }
});

app.post('/api/admin/asignar-premios', async (req, res) => {
  try {
    const folios = await db.all('SELECT id FROM folios');
    if (folios.length === 0) {
      return res.status(400).json({ error: "Primero debes generar los 100 códigos." });
    }

    let bolsaPremios = [];
    PREMIOS_CONFIG.forEach(p => {
      for (let i = 0; i < p.cantidad; i++) {
        bolsaPremios.push(p.premio);
      }
    });

    for (let i = bolsaPremios.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bolsaPremios[i], bolsaPremios[j]] = [bolsaPremios[j], bolsaPremios[i]];
    }

    for (let i = 0; i < folios.length; i++) {
      const premioAsignado = bolsaPremios[i] || "Suerte para la próxima";
      await db.run('UPDATE folios SET premio_asignado = ? WHERE id = ?', [premioAsignado, folios[i].id]);
    }

    res.json({ exito: true, mensaje: "Premios asignados correctamente." });
  } catch (err) {
    console.error("Error al asignar premios:", err);
    res.status(500).json({ error: "Error al asignar premios." });
  }
});

app.post('/api/admin/asignar-giros-extra', async (req, res) => {
  try {
    const folios = await db.all('SELECT id FROM folios');
    if (folios.length === 0) {
      return res.status(400).json({ error: "No hay folios registrados." });
    }

    // Limpiamos previos
    await db.run('UPDATE folios SET giros_restantes = 1, tipo_giro_extra = 0');

    // Repartiremos aleatoriamente giros extras (algunos con 1, otros con 2)
    let totalExtrasRepartir = 50;
    while (totalExtrasRepartir > 0) {
      const f = folios[Math.floor(Math.random() * folios.length)];
      const reg = await db.get('SELECT tipo_giro_extra FROM folios WHERE id = ?', [f.id]);
      
      if (reg.tipo_giro_extra === 0) {
        // Decidimos aleatoriamente si le damos 1 o 2 giros extras
        const cuantoDar = Math.random() < 0.5 ? 1 : 2;
        const girosTotalesIniciales = cuantoDar === 2 ? 3 : 2; // Si son 2 extras, tiene 3 tiros en total (2 extras + 1 final)

        await db.run(
          'UPDATE folios SET tipo_giro_extra = ?, giros_restantes = ? WHERE id = ?',
          [cuantoDar, girosTotalesIniciales, f.id]
        );
        totalExtrasRepartir -= cuantoDar;
      }
    }

    res.json({ exito: true, mensaje: "¡Giros extras distribuidos con la secuencia exacta (Extra -> Suerte -> Premio)!" });
  } catch (err) {
    console.error("Error al asignar giros extra:", err);
    res.status(500).json({ error: "Error al asignar giros extra." });
  }
});

app.delete('/api/admin/folios/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.run('DELETE FROM folios WHERE id = ?', [id]);
    res.json({ exito: true, mensaje: "Folio eliminado correctamente." });
  } catch (err) {
    res.status(500).json({ error: "Error al eliminar el folio." });
  }
});

app.delete('/api/admin/folios-todos', async (req, res) => {
  try {
    // 1. Borramos todos los registros de la tabla
    await db.run('DELETE FROM folios');
    
    // 2. 🔄 Reiniciamos el contador autoincrementable de SQLite a 0
    await db.run("DELETE FROM sqlite_sequence WHERE name='folios'");

    res.json({ exito: true, mensaje: "Se han eliminado todos los folios y reiniciado el contador." });
  } catch (err) {
    res.status(500).json({ error: "Error al eliminar todos los folios." });
  }
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`Servidor Backend corriendo en el puerto ${PORT}`);
});