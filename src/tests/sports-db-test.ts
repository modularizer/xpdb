/**
 * Sports Database Test
 * 
 * Sets up and seeds a semi-complex sports database with multiple tables,
 * foreign keys, unique constraints, enum columns, timestamps, and default values.
 */

import { 
  xpschema, 
  table, 
  text, 
  timestamp, 
  varchar, 
  uuid,
  uuidPK, 
  createOrRetrieveRegistryEntry,
  integer
} from '../xp-schema';
import { eq } from "drizzle-orm";

// Define the sports database schema

// Leagues table - top level
const leaguesTable = table('leagues', {
  id: uuidPK('id'),
  name: varchar('name', { length: 100 }).notNull().unique(),
  sportType: varchar('sport_type', { 
    length: 50, 
    enum: ['basketball', 'football', 'soccer', 'baseball', 'hockey'] as const 
  }).notNull(),
  country: varchar('country', { length: 100 }).notNull(),
  foundedYear: integer('founded_year'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Teams table - references leagues
const teamsTable = table('teams', {
  id: uuidPK('id'),
  name: varchar('name', { length: 100 }).notNull(),
  leagueId: uuid('league_id').notNull().references(() => leaguesTable.id),
  city: varchar('city', { length: 100 }).notNull(),
  foundedYear: integer('founded_year'),
  stadiumName: varchar('stadium_name', { length: 200 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Players table - references teams
const playersTable = table('players', {
  id: uuidPK('id'),
  name: varchar('name', { length: 200 }).notNull(),
  teamId: uuid('team_id').notNull().references(() => teamsTable.id),
  position: varchar('position', {
    length: 50,
    enum: ['point_guard', 'shooting_guard', 'small_forward', 'power_forward', 'center', 
           'quarterback', 'running_back', 'wide_receiver', 'tight_end', 'offensive_line',
           'defensive_line', 'linebacker', 'cornerback', 'safety', 'kicker',
           'forward', 'midfielder', 'defender', 'goalkeeper',
           'pitcher', 'catcher', 'first_base', 'second_base', 'third_base', 'shortstop', 'outfielder',
           'goalie', 'defenseman', 'winger', 'center'] as const
  }).notNull(),
  jerseyNumber: integer('jersey_number').notNull(),
  dateOfBirth: timestamp('date_of_birth'),
  salary: integer('salary'), // in thousands
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Games table - references teams (home and away)
const gamesTable = table('games', {
  id: uuidPK('id'),
  homeTeamId: uuid('home_team_id').notNull().references(() => teamsTable.id),
  awayTeamId: uuid('away_team_id').notNull().references(() => teamsTable.id),
  gameDate: timestamp('game_date').notNull(),
  homeScore: integer('home_score').default(0),
  awayScore: integer('away_score').default(0),
  status: varchar('status', {
    length: 50,
    enum: ['scheduled', 'in_progress', 'completed', 'postponed', 'cancelled'] as const
  }).notNull().default('scheduled'),
  attendance: integer('attendance'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// GameStats table - references games and players
const gameStatsTable = table('game_stats', {
  id: uuidPK('id'),
  gameId: uuid('game_id').notNull().references(() => gamesTable.id),
  playerId: uuid('player_id').notNull().references(() => playersTable.id),
  points: integer('points').default(0),
  rebounds: integer('rebounds').default(0),
  assists: integer('assists').default(0),
  minutesPlayed: integer('minutes_played').default(0),
  fieldGoalsMade: integer('field_goals_made').default(0),
  fieldGoalsAttempted: integer('field_goals_attempted').default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const sportsSchema = xpschema({
  leagues: leaguesTable,
  teams: teamsTable,
  players: playersTable,
  games: gamesTable,
  gameStats: gameStatsTable,
});

export interface LogCallback {
  (message: string, type?: 'log' | 'error' | 'success'): void;
}

/**
 * Run sports database setup and seeding
 * 
 * @param addLog - Callback function to log messages
 * @param dbName - Database name (default: 'sports-db')
 * @returns Promise that resolves when seeding completes
 */
export async function runSportsDBTest(
  addLog: LogCallback,
  dbName: string = 'sports-db'
): Promise<void> {
  addLog('🏀 Starting Sports Database setup...', 'log');

  // Step 1: Create or retrieve database connection
  addLog('📦 Creating database connection...', 'log');
  const connInfo = await createOrRetrieveRegistryEntry({
    name: dbName,
    driverName: 'pglite',
    dialectName: 'pg'
  });
  addLog(`✅ Connected to database: ${connInfo.name}`, 'success');

  // Step 2: Connect schema to database
  addLog('🔗 Connecting schema...', 'log');
  const db = await sportsSchema.connect(connInfo);
  addLog('✅ Schema connected', 'success');

  // Step 3: Create or migrate database schema
  addLog('📋 Creating or migrating database schema...', 'log');
  try {
    const migrationResult = await db.createOrMigrate();
    if (migrationResult.executed) {
      addLog('✅ Database schema migrated successfully', 'success');
      if (migrationResult.migrationSQL) {
        const statementCount = migrationResult.migrationSQL.split(';').filter(s => s.trim() && !s.trim().startsWith('--')).length;
        addLog(`📝 Migration SQL executed (${statementCount} statements)`, 'log');
        if (migrationResult.diff.addedTables.length > 0) {
          addLog(`   ➕ Added tables: ${migrationResult.diff.addedTables.join(', ')}`, 'log');
        }
      }
    } else {
      addLog('✅ Database schema is up to date', 'success');
    }
  } catch (error: any) {
    addLog(`⚠️  Schema migration: ${error.message}`, 'error');
    throw error;
  }

  // Step 4: Check if data already exists
  addLog('🔍 Checking for existing data...', 'log');
  const existingLeagues = await db.leagues.select();
  if (existingLeagues.length > 0) {
    addLog(`ℹ️  Found ${existingLeagues.length} existing league(s), skipping seed`, 'log');
    addLog('✅ Database is ready for browsing!', 'success');
    return;
  }

  // Step 5: Seed Leagues
  addLog('🌱 Seeding leagues...', 'log');
  const leagues = await db.leagues.insert([
    {
      name: 'National Basketball Association',
      sportType: 'basketball',
      country: 'United States',
      foundedYear: 1946,
    },
    {
      name: 'National Football League',
      sportType: 'football',
      country: 'United States',
      foundedYear: 1920,
    },
    {
      name: 'Premier League',
      sportType: 'soccer',
      country: 'England',
      foundedYear: 1992,
    },
    {
      name: 'Major League Baseball',
      sportType: 'baseball',
      country: 'United States',
      foundedYear: 1903,
    },
  ]).returning();
  
  const nbaId = leagues[0].id;
  const nflId = leagues[1].id;
  const premierLeagueId = leagues[2].id;
  const mlbId = leagues[3].id;
  addLog('✅ Seeded 4 leagues', 'success');

  // Step 6: Seed Teams
  addLog('🌱 Seeding teams...', 'log');
  const teams = await db.teams.insert([
    {
      name: 'Los Angeles Lakers',
      leagueId: nbaId,
      city: 'Los Angeles',
      foundedYear: 1947,
      stadiumName: 'Crypto.com Arena',
    },
    {
      name: 'Golden State Warriors',
      leagueId: nbaId,
      city: 'San Francisco',
      foundedYear: 1946,
      stadiumName: 'Chase Center',
    },
    {
      name: 'Boston Celtics',
      leagueId: nbaId,
      city: 'Boston',
      foundedYear: 1946,
      stadiumName: 'TD Garden',
    },
    {
      name: 'Kansas City Chiefs',
      leagueId: nflId,
      city: 'Kansas City',
      foundedYear: 1960,
      stadiumName: 'Arrowhead Stadium',
    },
    {
      name: 'New England Patriots',
      leagueId: nflId,
      city: 'Foxborough',
      foundedYear: 1960,
      stadiumName: 'Gillette Stadium',
    },
    {
      name: 'Manchester City',
      leagueId: premierLeagueId,
      city: 'Manchester',
      foundedYear: 1880,
      stadiumName: 'Etihad Stadium',
    },
    {
      name: 'Liverpool FC',
      leagueId: premierLeagueId,
      city: 'Liverpool',
      foundedYear: 1892,
      stadiumName: 'Anfield',
    },
    {
      name: 'New York Yankees',
      leagueId: mlbId,
      city: 'New York',
      foundedYear: 1903,
      stadiumName: 'Yankee Stadium',
    },
    {
      name: 'Boston Red Sox',
      leagueId: mlbId,
      city: 'Boston',
      foundedYear: 1901,
      stadiumName: 'Fenway Park',
    },
  ]).returning();
  
  const lakersId = teams[0].id;
  const warriorsId = teams[1].id;
  const celticsId = teams[2].id;
  const chiefsId = teams[3].id;
  const patriotsId = teams[4].id;
  const manCityId = teams[5].id;
  const liverpoolId = teams[6].id;
  const yankeesId = teams[7].id;
  const redSoxId = teams[8].id;
  addLog('✅ Seeded 9 teams', 'success');

  // Step 7: Seed Players
  addLog('🌱 Seeding players...', 'log');
  const players = await db.players.insert([
    // Lakers players
    { name: 'LeBron James', teamId: lakersId, position: 'small_forward' as const, jerseyNumber: 23, dateOfBirth: new Date('1984-12-30'), salary: 47610000 },
    { name: 'Anthony Davis', teamId: lakersId, position: 'power_forward' as const, jerseyNumber: 3, dateOfBirth: new Date('1993-03-11'), salary: 40600000 },
    { name: 'Russell Westbrook', teamId: lakersId, position: 'point_guard' as const, jerseyNumber: 0, dateOfBirth: new Date('1988-11-12'), salary: 47100000 },
    
    // Warriors players
    { name: 'Stephen Curry', teamId: warriorsId, position: 'point_guard' as const, jerseyNumber: 30, dateOfBirth: new Date('1988-03-14'), salary: 48070000 },
    { name: 'Klay Thompson', teamId: warriorsId, position: 'shooting_guard' as const, jerseyNumber: 11, dateOfBirth: new Date('1990-02-08'), salary: 40600000 },
    { name: 'Draymond Green', teamId: warriorsId, position: 'power_forward' as const, jerseyNumber: 23, dateOfBirth: new Date('1990-03-04'), salary: 25800000 },
    
    // Celtics players
    { name: 'Jayson Tatum', teamId: celticsId, position: 'small_forward' as const, jerseyNumber: 0, dateOfBirth: new Date('1998-03-03'), salary: 32600000 },
    { name: 'Jaylen Brown', teamId: celticsId, position: 'shooting_guard' as const, jerseyNumber: 7, dateOfBirth: new Date('1996-10-24'), salary: 28600000 },
    
    // Chiefs players
    { name: 'Patrick Mahomes', teamId: chiefsId, position: 'quarterback' as const, jerseyNumber: 15, dateOfBirth: new Date('1995-09-17'), salary: 45000000 },
    { name: 'Travis Kelce', teamId: chiefsId, position: 'tight_end' as const, jerseyNumber: 87, dateOfBirth: new Date('1989-10-05'), salary: 14100000 },
    
    // Patriots players
    { name: 'Mac Jones', teamId: patriotsId, position: 'quarterback' as const, jerseyNumber: 10, dateOfBirth: new Date('1998-09-05'), salary: 4000000 },
    { name: 'Matthew Judon', teamId: patriotsId, position: 'linebacker' as const, jerseyNumber: 9, dateOfBirth: new Date('1992-08-15'), salary: 13500000 },
    
    // Man City players
    { name: 'Erling Haaland', teamId: manCityId, position: 'forward' as const, jerseyNumber: 9, dateOfBirth: new Date('2000-07-21'), salary: 20000000 },
    { name: 'Kevin De Bruyne', teamId: manCityId, position: 'midfielder' as const, jerseyNumber: 17, dateOfBirth: new Date('1991-06-28'), salary: 25000000 },
    
    // Liverpool players
    { name: 'Mohamed Salah', teamId: liverpoolId, position: 'forward' as const, jerseyNumber: 11, dateOfBirth: new Date('1992-06-15'), salary: 22000000 },
    { name: 'Virgil van Dijk', teamId: liverpoolId, position: 'defender' as const, jerseyNumber: 4, dateOfBirth: new Date('1991-07-08'), salary: 18000000 },
    
    // Yankees players
    { name: 'Aaron Judge', teamId: yankeesId, position: 'outfielder' as const, jerseyNumber: 99, dateOfBirth: new Date('1992-04-26'), salary: 40000000 },
    { name: 'Gerrit Cole', teamId: yankeesId, position: 'pitcher' as const, jerseyNumber: 45, dateOfBirth: new Date('1990-09-08'), salary: 36000000 },
    
    // Red Sox players
    { name: 'Rafael Devers', teamId: redSoxId, position: 'third_base' as const, jerseyNumber: 11, dateOfBirth: new Date('1996-10-24'), salary: 17500000 },
    { name: 'Chris Sale', teamId: redSoxId, position: 'pitcher' as const, jerseyNumber: 41, dateOfBirth: new Date('1989-03-30'), salary: 27500000 },
  ]).returning();
  
  addLog(`✅ Seeded ${players.length} players`, 'success');

  // Step 8: Seed Games
  addLog('🌱 Seeding games...', 'log');
  const games = await db.games.insert([
    {
      homeTeamId: lakersId,
      awayTeamId: warriorsId,
      gameDate: new Date('2024-01-15T19:00:00Z'),
      homeScore: 108,
      awayScore: 112,
      status: 'completed',
      attendance: 18997,
    },
    {
      homeTeamId: celticsId,
      awayTeamId: lakersId,
      gameDate: new Date('2024-01-20T20:00:00Z'),
      homeScore: 125,
      awayScore: 119,
      status: 'completed',
      attendance: 19156,
    },
    {
      homeTeamId: chiefsId,
      awayTeamId: patriotsId,
      gameDate: new Date('2024-01-28T18:30:00Z'),
      homeScore: 27,
      awayScore: 17,
      status: 'completed',
      attendance: 76416,
    },
    {
      homeTeamId: manCityId,
      awayTeamId: liverpoolId,
      gameDate: new Date('2024-02-10T15:00:00Z'),
      homeScore: 1,
      awayScore: 1,
      status: 'completed',
      attendance: 53400,
    },
  ]).returning();
  
  const game1Id = games[0].id;
  const game2Id = games[1].id;
  const game3Id = games[2].id;
  const game4Id = games[3].id;
  addLog('✅ Seeded 4 games', 'success');

  // Step 9: Seed Game Stats
  addLog('🌱 Seeding game stats...', 'log');
  const lakersPlayers = players.filter(p => p.teamId === lakersId);
  const warriorsPlayers = players.filter(p => p.teamId === warriorsId);
  const celticsPlayers = players.filter(p => p.teamId === celticsId);
  const chiefsPlayers = players.filter(p => p.teamId === chiefsId);
  const patriotsPlayers = players.filter(p => p.teamId === patriotsId);
  const manCityPlayers = players.filter(p => p.teamId === manCityId);
  const liverpoolPlayers = players.filter(p => p.teamId === liverpoolId);

  await db.gameStats.insert([
    // Game 1: Lakers vs Warriors
    { gameId: game1Id, playerId: lakersPlayers[0].id, points: 28, rebounds: 8, assists: 12, minutesPlayed: 38, fieldGoalsMade: 11, fieldGoalsAttempted: 22 },
    { gameId: game1Id, playerId: lakersPlayers[1].id, points: 22, rebounds: 10, assists: 3, minutesPlayed: 35, fieldGoalsMade: 9, fieldGoalsAttempted: 16 },
    { gameId: game1Id, playerId: warriorsPlayers[0].id, points: 35, rebounds: 5, assists: 8, minutesPlayed: 36, fieldGoalsMade: 13, fieldGoalsAttempted: 24 },
    { gameId: game1Id, playerId: warriorsPlayers[1].id, points: 18, rebounds: 4, assists: 2, minutesPlayed: 32, fieldGoalsMade: 7, fieldGoalsAttempted: 15 },
    
    // Game 2: Celtics vs Lakers
    { gameId: game2Id, playerId: celticsPlayers[0].id, points: 32, rebounds: 9, assists: 6, minutesPlayed: 39, fieldGoalsMade: 12, fieldGoalsAttempted: 21 },
    { gameId: game2Id, playerId: celticsPlayers[1].id, points: 24, rebounds: 6, assists: 4, minutesPlayed: 37, fieldGoalsMade: 10, fieldGoalsAttempted: 18 },
    { gameId: game2Id, playerId: lakersPlayers[0].id, points: 30, rebounds: 7, assists: 11, minutesPlayed: 40, fieldGoalsMade: 12, fieldGoalsAttempted: 25 },
    
    // Game 3: Chiefs vs Patriots
    { gameId: game3Id, playerId: chiefsPlayers[0].id, points: 0, rebounds: 0, assists: 0, minutesPlayed: 60, fieldGoalsMade: 0, fieldGoalsAttempted: 0 },
    { gameId: game3Id, playerId: chiefsPlayers[1].id, points: 0, rebounds: 0, assists: 0, minutesPlayed: 58, fieldGoalsMade: 0, fieldGoalsAttempted: 0 },
    { gameId: game3Id, playerId: patriotsPlayers[0].id, points: 0, rebounds: 0, assists: 0, minutesPlayed: 60, fieldGoalsMade: 0, fieldGoalsAttempted: 0 },
    
    // Game 4: Man City vs Liverpool
    { gameId: game4Id, playerId: manCityPlayers[0].id, points: 1, rebounds: 0, assists: 0, minutesPlayed: 90, fieldGoalsMade: 1, fieldGoalsAttempted: 3 },
    { gameId: game4Id, playerId: liverpoolPlayers[0].id, points: 1, rebounds: 0, assists: 0, minutesPlayed: 90, fieldGoalsMade: 1, fieldGoalsAttempted: 4 },
  ]);
  
  addLog('✅ Seeded 13 game stats', 'success');

  // Step 10: Verify seeding
  addLog('🔍 Verifying seeded data...', 'log');
  const leagueCount = await db.leagues.count();
  const teamCount = await db.teams.count();
  const playerCount = await db.players.count();
  const gameCount = await db.games.count();
  const gameStatCount = await db.gameStats.count();

  addLog(`📊 Verification results:`, 'log');
  addLog(`   Leagues: ${leagueCount}`, 'log');
  addLog(`   Teams: ${teamCount}`, 'log');
  addLog(`   Players: ${playerCount}`, 'log');
  addLog(`   Games: ${gameCount}`, 'log');
  addLog(`   Game Stats: ${gameStatCount}`, 'log');
  addLog(`   Total Records: ${leagueCount + teamCount + playerCount + gameCount + gameStatCount}`, 'success');

  if (leagueCount === 4 && teamCount === 9 && playerCount === 20 && gameCount === 4 && gameStatCount === 13) {
    addLog('✅ All data seeded successfully!', 'success');
    addLog('🎉 Database is ready for browsing in xpdb-viewer!', 'success');
  } else {
    addLog('⚠️  Seeding verification: Some counts do not match expected values', 'log');
  }
}

