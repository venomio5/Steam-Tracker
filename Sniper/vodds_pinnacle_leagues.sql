-- MySQL dump 10.13  Distrib 8.0.41, for Win64 (x86_64)
--
-- Host: localhost    Database: vodds
-- ------------------------------------------------------
-- Server version	8.0.41

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `pinnacle_leagues`
--

DROP TABLE IF EXISTS `pinnacle_leagues`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `pinnacle_leagues` (
  `league_id` int NOT NULL AUTO_INCREMENT,
  `league_name` varchar(50) NOT NULL,
  `league_url` varchar(200) NOT NULL,
  `league_sport` varchar(50) NOT NULL,
  `league_last_updated_date` date NOT NULL,
  PRIMARY KEY (`league_id`)
) ENGINE=InnoDB AUTO_INCREMENT=47 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `pinnacle_leagues`
--

LOCK TABLES `pinnacle_leagues` WRITE;
/*!40000 ALTER TABLE `pinnacle_leagues` DISABLE KEYS */;
INSERT INTO `pinnacle_leagues` VALUES (1,'Germany - Bundesliga','https://www.pinnacle.com/en/soccer/germany-bundesliga/matchups/#period:0','Soccer','2025-05-07'),(2,'Spain - La Liga','https://www.pinnacle.com/en/soccer/spain-la-liga/matchups/#period:0','Soccer','2025-05-07'),(3,'England - Premier League','https://www.pinnacle.com/en/soccer/england-premier-league/matchups/#period:0','Soccer','2025-05-07'),(4,'Italy - Serie A','https://www.pinnacle.com/en/soccer/italy-serie-a/matchups/#period:0','Soccer','2025-05-07'),(5,'France - Ligue 1','https://www.pinnacle.com/en/soccer/france-ligue-1/matchups/#period:0','Soccer','2025-05-07'),(6,'UEFA - Europa League','https://www.pinnacle.com/en/soccer/uefa-europa-league/matchups/#period:0','Soccer','2025-05-07'),(7,'UEFA - Champions League','https://www.pinnacle.com/en/soccer/uefa-champions-league/matchups/#period:0','Soccer','2025-05-07'),(8,'UEFA - Conference League','https://www.pinnacle.com/en/soccer/uefa-conference-league/matchups/#period:0','Soccer','2025-05-07'),(9,'UEFA - Nations League','https://www.pinnacle.com/en/soccer/uefa-nations-league-playoffs/matchups/#period:0','Soccer','2025-05-07'),(10,'CONMEBOL - Copa Sudamericana','https://www.pinnacle.com/en/soccer/conmebol-copa-sudamericana/matchups/#period:0','Soccer','2025-05-07'),(11,'Argentina - Liga Pro','https://www.pinnacle.com/en/soccer/argentina-liga-pro/matchups/#period:0','Soccer','2025-05-07'),(13,'Brazil - Serie A','https://www.pinnacle.com/en/soccer/brazil-serie-a/matchups/#period:0','Soccer','2025-05-07'),(15,'Belgium - Pro League','https://www.pinnacle.com/en/soccer/belgium-pro-league/matchups/#period:0','Soccer','2025-05-07'),(16,'Colombia - Primera A','https://www.pinnacle.com/en/soccer/colombia-primera-a/matchups/#period:0','Soccer','2025-05-07'),(18,'CONMEBOL - Copa Libertadores','https://www.pinnacle.com/en/soccer/conmebol-copa-libertadores/matchups/#period:0','Soccer','2025-05-07'),(20,'England - Championship','https://www.pinnacle.com/en/soccer/england-championship/matchups/#period:0','Soccer','2025-05-07'),(21,'England - FA Cup','https://www.pinnacle.com/en/soccer/england-fa-cup/matchups/#period:0','Soccer','2025-05-07'),(25,'Germany - Cup','https://www.pinnacle.com/en/soccer/germany-cup/matchups/#period:0','Soccer','2025-05-07'),(28,'Japan - J League','https://www.pinnacle.com/en/soccer/japan-j-league/matchups/#period:0','Soccer','2025-05-07'),(29,'Mexico - Primera Division','https://www.pinnacle.com/en/soccer/mexico-primera-division/matchups/#period:0','Soccer','2025-05-07'),(30,'Mexico - Liga de Expansión MX','https://www.pinnacle.com/en/soccer/mexico-liga-de-expansin-mx/matchups/#period:0','Soccer','2025-05-07'),(32,'Netherlands - Eredivisie','https://www.pinnacle.com/en/soccer/netherlands-eredivisie/matchups/#period:0','Soccer','2025-05-07'),(34,'Portugal - Primeira Liga','https://www.pinnacle.com/en/soccer/portugal-primeira-liga/matchups/#period:0','Soccer','2025-05-07'),(35,'Russia - Premier League','https://www.pinnacle.com/en/soccer/russia-premier-league/matchups/#period:0','Soccer','2025-05-07'),(36,'Saudi Arabia - Pro League','https://www.pinnacle.com/en/soccer/saudi-arabia-pro-league/matchups/#period:0','Soccer','2025-05-07'),(37,'Spain - Copa del Rey','https://www.pinnacle.com/en/soccer/spain-copa-del-rey/matchups/#period:0','Soccer','2025-05-07'),(43,'USA - Major League Soccer','https://www.pinnacle.com/en/soccer/usa-major-league-soccer/matchups/#period:0','Soccer','2025-05-07'),(45,'MLB','https://www.pinnacle.com/en/baseball/mlb/matchups/#period:0','Baseball','2026-05-03'),(46,'NBA','https://www.pinnacle.com/en/basketball/nba/matchups/#period:0','Basketball','2026-05-03');
/*!40000 ALTER TABLE `pinnacle_leagues` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2025-05-16 11:41:16
