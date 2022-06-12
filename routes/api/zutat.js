const routes = require("express")()

require("dotenv").config()
const db = require("../../modules/db")
const preis = require("../../modules/preis")

routes.get("/alle", async (req, res) => {
    try {
        let qRes = await db.selectJSON(
            "rezept",
            [
                "rezept.id as id",
                "rezept.name as name",
                "rezept_art.name as rezept_art"
            ],
            `JOIN rezept_art
                ON rezept.rezept_art_id = rezept_art.id
            WHERE rezept_art.name = 'Zutat'`
        )

        res.json({
            zutaten: qRes
        })

    } catch(e) {
        res.status(500).send(e.stack || e)
    }
})


routes.get("/:id", async (req, res) => {
    try {

        let qResRezept = await db.selectJSON(
            "rezept",
            [
                "rezept.id as id",
                "rezept.name as name",
                "rezept.einheit_id as einheit_id",
                "rezept.menge as menge"
            ],
            `JOIN rezept_art
                ON rezept.rezept_art_id = rezept_art.id
            WHERE rezept_art.name = 'Zutat' AND rezept.id = ${req.params.id}`
        )

        if(qResRezept.length <= 0) {
            res.status(400).send(`Es existiert keine Zutat mit der id '${req.params.id}'`)
            return
        }

        if(qResRezept[0].menge == null) {
            qResRezept[0].menge = 0
        }
        qResRezept[0].menge = Math.round(qResRezept[0].menge / process.env.MENGE_FAKTOR)

        let qResZutaten = await db.selectJSON(
            "zutat",
            [
                "name",
                "anteil",
                "preis",
                "datum"
            ],
            `WHERE rezept_id = ${req.params.id}`
        )
        qResZutaten = qResZutaten.map(z => {
            z.preis = preis.preisDbInEurStr(z.preis)
            return z
        })

        let qResEinheit = await db.selectJSON(
            "einheit",
            [
                "id",
                "name"
            ]
        )

        res.json({
            rezept: qResRezept[0],
            zutaten: qResZutaten,
            einheit: qResEinheit
        })

    } catch(e) {
        res.status(500).send(e.stack || e)
    }
})


routes.post("/:id", async (req, res) => {
    try {

        // Rezept Speichern
        let rezeptDaten = req.body.rezept 
        rezeptDaten.rezept_art_id = "(SELECT id FROM rezept_art WHERE name = 'Zutat')"
        delete rezeptDaten.id

        if(rezeptDaten.menge) {
            rezeptDaten.menge = rezeptDaten.menge * process.env.MENGE_FAKTOR
        }

        await db.updateJSON(
            "rezept",
            rezeptDaten,
            `WHERE id=${req.params.id}`
        )


        // Anzahl an Varianten anpassen
        let count = await db.selectJSON(
            "zutat",
            [
                "COUNT(id)"
            ],
            `WHERE rezept_id = ${req.params.id}`
        )
        count = count[0].count

        if(count > req.body.zutaten.length) {
            await db.query(`DELETE FROM zutat WHERE id IN (SELECT id FROM zutat WHERE rezept_id=${req.params.id} LIMIT ${count - req.body.zutaten.length})`)
        } else if( count < req.body.zutaten.length) {
            await db.query(`INSERT INTO zutat (rezept_id) SELECT ${req.params.id} FROM generate_series(1, ${req.body.zutaten.length - count})`)
        }


        // varianten Hinzufügen
        let ids = await db.selectJSON(
            "zutat",
            [
                "id"
            ],
            `WHERE rezept_id = ${req.params.id}`
        )

        let promises = []
        for(let i=0; i<ids.length; i++) {
            delete req.body.zutaten[i].rezept_id
            delete req.body.zutaten[i].id

            if(req.body.zutaten[i]?.preis) {
                req.body.zutaten[i].preis = preis.preisEurStrInDb(req.body.zutaten[i].preis)
            }

            promises.push( db.updateJSON(
                "zutat",
                req.body.zutaten[i],
                `WHERE id = ${ids[i].id}`
            ))
        }
        await Promise.all(promises)

        res.sendStatus(200)
        
    } catch(e) {
        res.status(500).send(e.stack || e)
    }
})


routes.put("/", async (req, res) => {
    try {
        let qRes = await db.insertJSON(
            "rezept",
            {
                name: "Neue Zutat",
                einheit_id: "(SELECT id FROM einheit WHERE name = 'St.')",
                rezept_art_id: "(SELECT id FROM rezept_art WHERE name = 'Zutat')"
            },
            "RETURNING id"
        )

        if(qRes.length <= 0) {
            throw Error("Zutat konnte nicht erstellt werden")
        }

        res.json({
            id: qRes[0].id
        })

    } catch(e) {
        res.status(500).send(e.stack || e)
    }
})

routes.delete("/:id", async (req, res) => {
    try {
        await db.deleteRow("rezept", `WHERE id = ${req.params.id}`)
        await db.deleteRow("zutat", `WHERE rezept_id = ${req.params.id}`)

        res.sendStatus(200)
    } catch(e) {
        res.status(500).send(e.stack || e)
    }
})

module.exports = routes