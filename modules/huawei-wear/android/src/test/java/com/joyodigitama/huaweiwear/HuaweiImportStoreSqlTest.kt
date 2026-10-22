package com.joyodigitama.huaweiwear

import java.io.File
import java.nio.file.Files
import java.sql.DriverManager
import org.json.JSONArray
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test

/** [SqliteHuaweiImportStore] on the shipped schema (sqlite-jdbc): the rules of its statements, with made-up values. */
class HuaweiImportStoreSqlTest {
  private val dir: File = Files.createTempDirectory("huawei-import-store").toFile()
  private val file = File(dir, "joyofit.db")
  private val jdbc = DriverManager.getConnection("jdbc:sqlite:${file.path}")
  private val db = WearDatabase(file.path, JdbcSqlConnection(jdbc))
  private val store = SqliteHuaweiImportStore { db }

  init {
    val migrations = JSONArray(File("../schema/joyofit-db-migrations.json").readText())
    for (i in 0 until migrations.length()) {
      val statements = migrations.getJSONArray(i)
      for (j in 0 until statements.length()) db.execSQL(statements.getString(j))
    }
  }

  /** The table as JS creates it (`ensureScaleSchema`, `src/features/scale/store.ts`): the importer's own `IF NOT EXISTS` must agree with it. */
  private fun createScaleTableLikeJs() = db.execSQL(
    """CREATE TABLE IF NOT EXISTS scale_reading (
         id INTEGER PRIMARY KEY AUTOINCREMENT, scale_id TEXT NOT NULL, taken_at INTEGER NOT NULL, weight_kg REAL NOT NULL,
         impedance_ohm REAL, reported TEXT, estimate TEXT, rogo_state TEXT NOT NULL DEFAULT 'pending', rogo_error TEXT)""",
  )

  @After
  fun close() {
    db.close()
    dir.deleteRecursively()
  }

  private fun count(sql: String): Long = jdbc.createStatement().use { s -> s.executeQuery(sql).use { it.next(); it.getLong(1) } }

  private val t0 = 1_750_000_020_000L

  @Test
  fun weighInsLandInScaleReadingAndAnImportRunTwiceAddsNothing() {
    val rows = listOf(
      ImportedWeighIn(t0, 71.5, 500.0, """{"bodyFatPct":21.3,"bmi":22.4}"""),
      ImportedWeighIn(t0 + 86_400_000, 71.2, null, null),
    )
    assertEquals(2, store.writeWeighIns(rows))
    assertEquals(0, store.writeWeighIns(rows))
    assertEquals(2, count("SELECT COUNT(*) FROM scale_reading WHERE scale_id = 'huawei-health-export' AND rogo_state = 'skipped'"))
    assertEquals(1, count("SELECT COUNT(*) FROM scale_reading WHERE reported LIKE '%bodyFatPct%' AND impedance_ohm = 500"))
  }

  @Test
  fun aWeighInThatTheScaleAlreadyDeliveredIsNotDuplicated() {
    createScaleTableLikeJs()
    db.execSQL(
      "INSERT INTO scale_reading (scale_id, taken_at, weight_kg, rogo_state) VALUES ('AA:BB', ?, 71.4, 'sent')",
      arrayOf<Any>(t0 + 20_000),
    )
    assertEquals(0, store.writeWeighIns(listOf(ImportedWeighIn(t0, 71.5, null, null))))
    // A different weight at the same moment is another person on the scale, not the same weighing.
    assertEquals(1, store.writeWeighIns(listOf(ImportedWeighIn(t0, 90.0, null, null))))
  }

  @Test
  fun minutesAreMergedAndASecondRunChangesNothing() {
    val minute = ImportedMinute(1_750_000_020L).also { it.steps = 10; it.heartRate = 80 }
    assertEquals(1, store.writeMinutes(listOf(minute)))
    assertEquals(0, store.writeMinutes(listOf(minute)))
    assertEquals(1, count("SELECT COUNT(*) FROM step_samples WHERE heart_rate = 80 AND steps = 10 AND imported = 1"))
  }
}
