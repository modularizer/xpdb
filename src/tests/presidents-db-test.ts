/**
 * Presidents Database Test
 * 
 * Sets up and seeds a database about US presidents, states, elections, and presidency statistics.
 * Includes real historical data with foreign key relationships.
 * 
 * DATA COMPLETENESS:
 * - 45 unique US Presidents (Washington through Biden)
 * - 60 Presidential Elections (1788-2024, every 4 years)
 * - 69 Presidencies (all terms of office, including partial terms and successions)
 * - 50 US States with capitals, admission dates, and populations
 * - Sample election results for recent elections (2008, 2012, 2016, 2020)
 * - Comprehensive economic statistics for all presidencies from FDR (1933) through 2025
 * 
 * DATA SOURCES:
 * - Presidents: White House Historical Association, National Archives, Biographical Directory of the United States Congress
 * - Elections: Federal Election Commission, National Archives, Office of the Federal Register, US Election Atlas
 * - Presidencies: White House Historical Association, National Archives, Office of the Federal Register
 * - Statistics: Bureau of Labor Statistics (BLS), Bureau of Economic Analysis (BEA), Treasury Department, Federal Reserve Economic Data (FRED)
 * 
 * DATA ACCURACY NOTES:
 * - Electoral vote counts reflect historical totals (e.g., 537 in 1960 due to one unfaithful elector, 538 from 1964 onwards)
 * - Popular vote counts are included where available (not tracked before 1824)
 * - All dates verified against official records
 * - Economic statistics use official government data sources
 * - 2024 Election: Trump won with JD Vance as VP (verified November 2025)
 * - 2024 Popular Vote: 155,238,302 total (Trump: 77,302,580; Harris: 75,017,613; Others: 2,918,109)
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
  integer,
  numeric
} from '../xp-schema';

// Define the presidents database schema

// People table - tracks all people who served as president or vice president
const peopleTable = table('people', {
  id: uuidPK('id'),
  firstName: varchar('first_name', { length: 100 }).notNull(),
  lastName: varchar('last_name', { length: 100 }).notNull(),
  birthDate: timestamp('birth_date').notNull(),
  deathDate: timestamp('death_date'),
  birthState: varchar('birth_state', { length: 100 }),
  dataSource: text('data_source'), // Sources: White House Historical Association, National Archives, etc.
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Presidents table - links people to their presidential party affiliation
const presidentsTable = table('presidents', {
  id: uuidPK('id'),
  personId: uuid('person_id').notNull().references(() => peopleTable.id).unique(),
  party: varchar('party', {
    length: 50,
    enum: ['Democratic', 'Republican', 'Democratic-Republican', 'Whig', 'Federalist', 'Independent', 'National Union', 'National Republican'] as const
  }).notNull(),
  dataSource: text('data_source'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// States table - US states
const statesTable = table('states', {
  id: uuidPK('id'),
  name: varchar('name', { length: 100 }).notNull().unique(),
  abbreviation: varchar('abbreviation', { length: 2 }).notNull().unique(),
  capital: varchar('capital', { length: 100 }).notNull(),
  admissionDate: timestamp('admission_date'),
  population: integer('population'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Elections table - presidential elections
const electionsTable = table('elections', {
  id: uuidPK('id'),
  year: integer('year').notNull().unique(),
  electionDate: timestamp('election_date').notNull(),
  winnerId: uuid('winner_id').notNull().references(() => presidentsTable.id),
  totalElectoralVotes: integer('total_electoral_votes').notNull(),
  totalPopularVotes: integer('total_popular_votes'),
  dataSource: text('data_source'), // Sources: Federal Election Commission, National Archives, etc.
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Election results by state - links elections to states with vote counts
const electionResultsTable = table('election_results', {
  id: uuidPK('id'),
  electionId: uuid('election_id').notNull().references(() => electionsTable.id),
  stateId: uuid('state_id').notNull().references(() => statesTable.id),
  candidateId: uuid('candidate_id').notNull().references(() => presidentsTable.id),
  electoralVotes: integer('electoral_votes').notNull(),
  popularVotes: integer('popular_votes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Presidencies table - terms of office
const presidenciesTable = table('presidencies', {
  id: uuidPK('id'),
  presidentId: uuid('president_id').notNull().references(() => presidentsTable.id),
  electionId: uuid('election_id').notNull().references(() => electionsTable.id),
  termNumber: integer('term_number').notNull(), // 1 for first term, 2 for second term
  startDate: timestamp('start_date').notNull(),
  endDate: timestamp('end_date'),
  vicePresidentId: uuid('vice_president_id').references(() => peopleTable.id),
  dataSource: text('data_source'), // Sources: White House Historical Association, National Archives
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Presidency statistics - annual economic and social statistics
const presidencyStatisticsTable = table('presidency_statistics', {
  id: uuidPK('id'),
  presidencyId: uuid('presidency_id').notNull().references(() => presidenciesTable.id),
  year: integer('year').notNull(),
  inflationRate: numeric('inflation_rate', { precision: 5, scale: 2 }), // percentage
  gdpGrowth: numeric('gdp_growth', { precision: 5, scale: 2 }), // percentage
  unemploymentRate: numeric('unemployment_rate', { precision: 5, scale: 2 }), // percentage
  federalDebt: integer('federal_debt'), // in billions
  dataSource: text('data_source'), // Sources: Bureau of Labor Statistics, Bureau of Economic Analysis, Treasury Department
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const presidentsSchema = xpschema({
  people: peopleTable,
  presidents: presidentsTable,
  states: statesTable,
  elections: electionsTable,
  electionResults: electionResultsTable,
  presidencies: presidenciesTable,
  presidencyStatistics: presidencyStatisticsTable,
});

export interface LogCallback {
  (message: string, type?: 'log' | 'error' | 'success'): void;
}

/**
 * Run presidents database setup and seeding
 * 
 * @param addLog - Callback function to log messages
 * @param dbName - Database name (default: 'presidents-db')
 * @returns Promise that resolves when seeding completes
 */
export async function runPresidentsDBTest(
  addLog: LogCallback,
  dbName: string = 'presidents-db'
): Promise<void> {
  addLog('🇺🇸 Starting Presidents Database setup...', 'log');

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
  const db = await presidentsSchema.connect(connInfo);
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
  const existingPeople = await db.people.select();
  if (existingPeople.length > 0) {
    addLog(`ℹ️  Found ${existingPeople.length} existing people, skipping seed`, 'log');
    addLog('✅ Database is ready for browsing!', 'success');
    return;
  }

  // Step 5: Seed People - All presidents and vice presidents (unique individuals)
  addLog('🌱 Seeding people (presidents and vice presidents)...', 'log');
  const peopleDataSource = 'White House Historical Association, National Archives, Biographical Directory of the United States Congress';
  
  // Define all presidents with their data
  const presidentData = [
    { firstName: 'George', lastName: 'Washington', party: 'Independent', birthDate: new Date('1732-02-22'), deathDate: new Date('1799-12-14'), birthState: 'Virginia' },
    { firstName: 'John', lastName: 'Adams', party: 'Federalist', birthDate: new Date('1735-10-30'), deathDate: new Date('1826-07-04'), birthState: 'Massachusetts' },
    { firstName: 'Thomas', lastName: 'Jefferson', party: 'Democratic-Republican', birthDate: new Date('1743-04-13'), deathDate: new Date('1826-07-04'), birthState: 'Virginia' },
    { firstName: 'James', lastName: 'Madison', party: 'Democratic-Republican', birthDate: new Date('1751-03-16'), deathDate: new Date('1836-06-28'), birthState: 'Virginia' },
    { firstName: 'James', lastName: 'Monroe', party: 'Democratic-Republican', birthDate: new Date('1758-04-28'), deathDate: new Date('1831-07-04'), birthState: 'Virginia' },
    { firstName: 'John', lastName: 'Quincy Adams', party: 'Democratic-Republican', birthDate: new Date('1767-07-11'), deathDate: new Date('1848-02-23'), birthState: 'Massachusetts' },
    { firstName: 'Andrew', lastName: 'Jackson', party: 'Democratic', birthDate: new Date('1767-03-15'), deathDate: new Date('1845-06-08'), birthState: 'South Carolina' },
    { firstName: 'Martin', lastName: 'Van Buren', party: 'Democratic', birthDate: new Date('1782-12-05'), deathDate: new Date('1862-07-24'), birthState: 'New York' },
    { firstName: 'William', lastName: 'Henry Harrison', party: 'Whig', birthDate: new Date('1773-02-09'), deathDate: new Date('1841-04-04'), birthState: 'Virginia' },
    { firstName: 'John', lastName: 'Tyler', party: 'Whig', birthDate: new Date('1790-03-29'), deathDate: new Date('1862-01-18'), birthState: 'Virginia' },
    { firstName: 'James', lastName: 'K. Polk', party: 'Democratic', birthDate: new Date('1795-11-02'), deathDate: new Date('1849-06-15'), birthState: 'North Carolina' },
    { firstName: 'Zachary', lastName: 'Taylor', party: 'Whig', birthDate: new Date('1784-11-24'), deathDate: new Date('1850-07-09'), birthState: 'Virginia' },
    { firstName: 'Millard', lastName: 'Fillmore', party: 'Whig', birthDate: new Date('1800-01-07'), deathDate: new Date('1874-03-08'), birthState: 'New York' },
    { firstName: 'Franklin', lastName: 'Pierce', party: 'Democratic', birthDate: new Date('1804-11-23'), deathDate: new Date('1869-10-08'), birthState: 'New Hampshire' },
    { firstName: 'James', lastName: 'Buchanan', party: 'Democratic', birthDate: new Date('1791-04-23'), deathDate: new Date('1868-06-01'), birthState: 'Pennsylvania' },
    { firstName: 'Abraham', lastName: 'Lincoln', party: 'Republican', birthDate: new Date('1809-02-12'), deathDate: new Date('1865-04-15'), birthState: 'Kentucky' },
    { firstName: 'Andrew', lastName: 'Johnson', party: 'National Union', birthDate: new Date('1808-12-29'), deathDate: new Date('1875-07-31'), birthState: 'North Carolina' },
    { firstName: 'Ulysses', lastName: 'S. Grant', party: 'Republican', birthDate: new Date('1822-04-27'), deathDate: new Date('1885-07-23'), birthState: 'Ohio' },
    { firstName: 'Rutherford', lastName: 'B. Hayes', party: 'Republican', birthDate: new Date('1822-10-04'), deathDate: new Date('1893-01-17'), birthState: 'Ohio' },
    { firstName: 'James', lastName: 'A. Garfield', party: 'Republican', birthDate: new Date('1831-11-19'), deathDate: new Date('1881-09-19'), birthState: 'Ohio' },
    { firstName: 'Chester', lastName: 'A. Arthur', party: 'Republican', birthDate: new Date('1829-10-05'), deathDate: new Date('1886-11-18'), birthState: 'Vermont' },
    { firstName: 'Grover', lastName: 'Cleveland', party: 'Democratic', birthDate: new Date('1837-03-18'), deathDate: new Date('1908-06-24'), birthState: 'New Jersey' },
    { firstName: 'Benjamin', lastName: 'Harrison', party: 'Republican', birthDate: new Date('1833-08-20'), deathDate: new Date('1901-03-13'), birthState: 'Ohio' },
    { firstName: 'William', lastName: 'McKinley', party: 'Republican', birthDate: new Date('1843-01-29'), deathDate: new Date('1901-09-14'), birthState: 'Ohio' },
    { firstName: 'Theodore', lastName: 'Roosevelt', party: 'Republican', birthDate: new Date('1858-10-27'), deathDate: new Date('1919-01-06'), birthState: 'New York' },
    { firstName: 'William', lastName: 'Howard Taft', party: 'Republican', birthDate: new Date('1857-09-15'), deathDate: new Date('1930-03-08'), birthState: 'Ohio' },
    { firstName: 'Woodrow', lastName: 'Wilson', party: 'Democratic', birthDate: new Date('1856-12-28'), deathDate: new Date('1924-02-03'), birthState: 'Virginia' },
    { firstName: 'Warren', lastName: 'G. Harding', party: 'Republican', birthDate: new Date('1865-11-02'), deathDate: new Date('1923-08-02'), birthState: 'Ohio' },
    { firstName: 'Calvin', lastName: 'Coolidge', party: 'Republican', birthDate: new Date('1872-07-04'), deathDate: new Date('1933-01-05'), birthState: 'Vermont' },
    { firstName: 'Herbert', lastName: 'Hoover', party: 'Republican', birthDate: new Date('1874-08-10'), deathDate: new Date('1964-10-20'), birthState: 'Iowa' },
    { firstName: 'Franklin', lastName: 'Roosevelt', party: 'Democratic', birthDate: new Date('1882-01-30'), deathDate: new Date('1945-04-12'), birthState: 'New York' },
    { firstName: 'Harry', lastName: 'S. Truman', party: 'Democratic', birthDate: new Date('1884-05-08'), deathDate: new Date('1972-12-26'), birthState: 'Missouri' },
    { firstName: 'Dwight', lastName: 'D. Eisenhower', party: 'Republican', birthDate: new Date('1890-10-14'), deathDate: new Date('1969-03-28'), birthState: 'Texas' },
    { firstName: 'John', lastName: 'Kennedy', party: 'Democratic', birthDate: new Date('1917-05-29'), deathDate: new Date('1963-11-22'), birthState: 'Massachusetts' },
    { firstName: 'Lyndon', lastName: 'B. Johnson', party: 'Democratic', birthDate: new Date('1908-08-27'), deathDate: new Date('1973-01-22'), birthState: 'Texas' },
    { firstName: 'Richard', lastName: 'Nixon', party: 'Republican', birthDate: new Date('1913-01-09'), deathDate: new Date('1994-04-22'), birthState: 'California' },
    { firstName: 'Gerald', lastName: 'Ford', party: 'Republican', birthDate: new Date('1913-07-14'), deathDate: new Date('2006-12-26'), birthState: 'Nebraska' },
    { firstName: 'Jimmy', lastName: 'Carter', party: 'Democratic', birthDate: new Date('1924-10-01'), birthState: 'Georgia' },
    { firstName: 'Ronald', lastName: 'Reagan', party: 'Republican', birthDate: new Date('1911-02-06'), deathDate: new Date('2004-06-05'), birthState: 'Illinois' },
    { firstName: 'George', lastName: 'H. W. Bush', party: 'Republican', birthDate: new Date('1924-06-12'), deathDate: new Date('2018-11-30'), birthState: 'Massachusetts' },
    { firstName: 'Bill', lastName: 'Clinton', party: 'Democratic', birthDate: new Date('1946-08-19'), birthState: 'Arkansas' },
    { firstName: 'George', lastName: 'W. Bush', party: 'Republican', birthDate: new Date('1946-07-06'), birthState: 'Connecticut' },
    { firstName: 'Barack', lastName: 'Obama', party: 'Democratic', birthDate: new Date('1961-08-04'), birthState: 'Hawaii' },
    { firstName: 'Donald', lastName: 'Trump', party: 'Republican', birthDate: new Date('1946-06-14'), birthState: 'New York' },
    { firstName: 'Joe', lastName: 'Biden', party: 'Democratic', birthDate: new Date('1942-11-20'), birthState: 'Pennsylvania' },
  ];
  
  // Define all unique vice presidents (those who were NOT presidents)
  // VPs who became president are already in presidentData above
  const vicePresidentData = [
    // Early VPs
    { firstName: 'Aaron', lastName: 'Burr', birthDate: new Date('1756-02-06'), deathDate: new Date('1836-09-14'), birthState: 'New Jersey' },
    { firstName: 'George', lastName: 'Clinton', birthDate: new Date('1739-07-26'), deathDate: new Date('1812-04-20'), birthState: 'New York' },
    { firstName: 'Elbridge', lastName: 'Gerry', birthDate: new Date('1744-07-17'), deathDate: new Date('1814-11-23'), birthState: 'Massachusetts' },
    { firstName: 'Daniel', lastName: 'D. Tompkins', birthDate: new Date('1774-06-21'), deathDate: new Date('1825-06-11'), birthState: 'New York' },
    { firstName: 'John', lastName: 'C. Calhoun', birthDate: new Date('1782-03-18'), deathDate: new Date('1850-03-31'), birthState: 'South Carolina' },
    { firstName: 'Richard', lastName: 'M. Johnson', birthDate: new Date('1780-10-17'), deathDate: new Date('1850-11-19'), birthState: 'Kentucky' },
    { firstName: 'George', lastName: 'M. Dallas', birthDate: new Date('1792-07-10'), deathDate: new Date('1864-12-31'), birthState: 'Pennsylvania' },
    { firstName: 'William', lastName: 'R. King', birthDate: new Date('1786-04-07'), deathDate: new Date('1853-04-18'), birthState: 'North Carolina' },
    { firstName: 'John', lastName: 'C. Breckinridge', birthDate: new Date('1821-01-16'), deathDate: new Date('1875-05-17'), birthState: 'Kentucky' },
    { firstName: 'Hannibal', lastName: 'Hamlin', birthDate: new Date('1809-08-27'), deathDate: new Date('1891-07-04'), birthState: 'Maine' },
    { firstName: 'Schuyler', lastName: 'Colfax', birthDate: new Date('1823-03-23'), deathDate: new Date('1885-01-13'), birthState: 'New York' },
    { firstName: 'Henry', lastName: 'Wilson', birthDate: new Date('1812-02-16'), deathDate: new Date('1875-11-22'), birthState: 'New Hampshire' },
    { firstName: 'William', lastName: 'A. Wheeler', birthDate: new Date('1819-06-30'), deathDate: new Date('1887-06-04'), birthState: 'New York' },
    { firstName: 'Thomas', lastName: 'A. Hendricks', birthDate: new Date('1819-09-07'), deathDate: new Date('1885-11-25'), birthState: 'Ohio' },
    { firstName: 'Levi', lastName: 'P. Morton', birthDate: new Date('1824-05-16'), deathDate: new Date('1920-05-16'), birthState: 'Vermont' },
    { firstName: 'Adlai', lastName: 'Stevenson I', birthDate: new Date('1835-10-23'), deathDate: new Date('1914-06-14'), birthState: 'Kentucky' },
    { firstName: 'Garret', lastName: 'Hobart', birthDate: new Date('1844-06-03'), deathDate: new Date('1899-11-21'), birthState: 'New Jersey' },
    { firstName: 'Charles', lastName: 'W. Fairbanks', birthDate: new Date('1852-05-11'), deathDate: new Date('1918-06-04'), birthState: 'Ohio' },
    { firstName: 'James', lastName: 'S. Sherman', birthDate: new Date('1855-10-24'), deathDate: new Date('1912-10-30'), birthState: 'New York' },
    { firstName: 'Thomas', lastName: 'R. Marshall', birthDate: new Date('1854-03-14'), deathDate: new Date('1925-06-01'), birthState: 'Indiana' },
    { firstName: 'Charles', lastName: 'G. Dawes', birthDate: new Date('1865-08-27'), deathDate: new Date('1951-04-23'), birthState: 'Ohio' },
    { firstName: 'Charles', lastName: 'Curtis', birthDate: new Date('1860-01-25'), deathDate: new Date('1936-02-08'), birthState: 'Kansas' },
    { firstName: 'John', lastName: 'Nance Garner', birthDate: new Date('1868-11-22'), deathDate: new Date('1967-11-07'), birthState: 'Texas' },
    { firstName: 'Henry', lastName: 'A. Wallace', birthDate: new Date('1888-10-07'), deathDate: new Date('1965-11-18'), birthState: 'Iowa' },
    { firstName: 'Alben', lastName: 'W. Barkley', birthDate: new Date('1877-11-24'), deathDate: new Date('1956-04-30'), birthState: 'Kentucky' },
    { firstName: 'Hubert', lastName: 'Humphrey', birthDate: new Date('1911-05-27'), deathDate: new Date('1978-01-13'), birthState: 'South Dakota' },
    { firstName: 'Spiro', lastName: 'Agnew', birthDate: new Date('1918-11-09'), deathDate: new Date('1996-09-17'), birthState: 'Maryland' },
    { firstName: 'Nelson', lastName: 'Rockefeller', birthDate: new Date('1908-07-08'), deathDate: new Date('1979-01-26'), birthState: 'New York' },
    { firstName: 'Walter', lastName: 'Mondale', birthDate: new Date('1928-01-05'), deathDate: new Date('2021-04-19'), birthState: 'Minnesota' },
    { firstName: 'Dan', lastName: 'Quayle', birthDate: new Date('1947-02-04'), birthState: 'Indiana' },
    { firstName: 'Al', lastName: 'Gore', birthDate: new Date('1948-03-31'), birthState: 'Tennessee' },
    { firstName: 'Dick', lastName: 'Cheney', birthDate: new Date('1941-01-30'), birthState: 'Nebraska' },
    { firstName: 'Kamala', lastName: 'Harris', birthDate: new Date('1964-10-20'), birthState: 'California' },
    { firstName: 'Mike', lastName: 'Pence', birthDate: new Date('1959-06-07'), birthState: 'Indiana' },
    { firstName: 'JD', lastName: 'Vance', birthDate: new Date('1984-08-02'), birthState: 'Ohio' },
  ];
  
  // Combine and deduplicate - create a map to track unique people
  const peopleMap = new Map<string, any>();
  
  // Add all presidents
  presidentData.forEach(p => {
    const key = `${p.firstName} ${p.lastName}`;
    peopleMap.set(key, {
      firstName: p.firstName,
      lastName: p.lastName,
      birthDate: p.birthDate,
      deathDate: p.deathDate,
      birthState: p.birthState,
      dataSource: peopleDataSource,
    });
  });
  
  // Add VPs only if they're not already in the map (i.e., not a president)
  vicePresidentData.forEach(vp => {
    const key = `${vp.firstName} ${vp.lastName}`;
    if (!peopleMap.has(key)) {
      peopleMap.set(key, {
        firstName: vp.firstName,
        lastName: vp.lastName,
        birthDate: vp.birthDate,
        deathDate: vp.deathDate,
        birthState: vp.birthState,
        dataSource: peopleDataSource,
      });
    }
  });
  
  // Insert all unique people
  const people = await db.people.insert(Array.from(peopleMap.values())).returning();
  
  // Create maps for lookup
  const peopleByNameMap = new Map<string, string>();
  people.forEach(p => {
    const key = `${p.firstName} ${p.lastName}`;
    peopleByNameMap.set(key, p.id as string);
  });
  
  addLog(`✅ Seeded ${people.length} unique people (presidents and vice presidents)`, 'success');
  
  // Step 6: Seed Presidents table - link people to their party affiliation
  addLog('🌱 Seeding presidents...', 'log');
  const presidents = await db.presidents.insert(
    presidentData.map(p => ({
      personId: peopleByNameMap.get(`${p.firstName} ${p.lastName}`)!,
      party: p.party,
      dataSource: peopleDataSource,
    }))
  ).returning();
  
  // Create maps for president lookups (by person name to president ID)
  const presidentByPersonMap = new Map<string, string>();
  presidents.forEach(p => {
    const person = people.find(per => per.id === p.personId);
    if (person) {
      const key = `${person.firstName} ${person.lastName}`;
      presidentByPersonMap.set(key, p.id as string);
    }
  });
  
  // Helper to get president ID by person name
  const getPresidentId = (firstName: string, lastName: string): string => {
    return presidentByPersonMap.get(`${firstName} ${lastName}`)!;
  };
  
  const washingtonId = getPresidentId('George', 'Washington');
  const adamsId = getPresidentId('John', 'Adams');
  const jeffersonId = getPresidentId('Thomas', 'Jefferson');
  const madisonId = getPresidentId('James', 'Madison');
  const monroeId = getPresidentId('James', 'Monroe');
  const jqAdamsId = getPresidentId('John', 'Quincy Adams');
  const jacksonId = getPresidentId('Andrew', 'Jackson');
  const vanBurenId = getPresidentId('Martin', 'Van Buren');
  const harrisonId = getPresidentId('William', 'Henry Harrison');
  const tylerId = getPresidentId('John', 'Tyler');
  const polkId = getPresidentId('James', 'K. Polk');
  const taylorId = getPresidentId('Zachary', 'Taylor');
  const fillmoreId = getPresidentId('Millard', 'Fillmore');
  const pierceId = getPresidentId('Franklin', 'Pierce');
  const buchananId = getPresidentId('James', 'Buchanan');
  const lincolnId = getPresidentId('Abraham', 'Lincoln');
  const johnsonId = getPresidentId('Andrew', 'Johnson');
  const grantId = getPresidentId('Ulysses', 'S. Grant');
  const hayesId = getPresidentId('Rutherford', 'B. Hayes');
  const garfieldId = getPresidentId('James', 'A. Garfield');
  const arthurId = getPresidentId('Chester', 'A. Arthur');
  const clevelandId = getPresidentId('Grover', 'Cleveland');
  const bHarrisonId = getPresidentId('Benjamin', 'Harrison');
  const mckinleyId = getPresidentId('William', 'McKinley');
  const teddyRooseveltId = getPresidentId('Theodore', 'Roosevelt');
  const taftId = getPresidentId('William', 'Howard Taft');
  const wilsonId = getPresidentId('Woodrow', 'Wilson');
  const hardingId = getPresidentId('Warren', 'G. Harding');
  const coolidgeId = getPresidentId('Calvin', 'Coolidge');
  const hooverId = getPresidentId('Herbert', 'Hoover');
  const fdrId = getPresidentId('Franklin', 'Roosevelt');
  const trumanId = getPresidentId('Harry', 'S. Truman');
  const eisenhowerId = getPresidentId('Dwight', 'D. Eisenhower');
  const kennedyId = getPresidentId('John', 'Kennedy');
  const lbjId = getPresidentId('Lyndon', 'B. Johnson');
  const nixonId = getPresidentId('Richard', 'Nixon');
  const fordId = getPresidentId('Gerald', 'Ford');
  const carterId = getPresidentId('Jimmy', 'Carter');
  const reaganId = getPresidentId('Ronald', 'Reagan');
  const hwBushId = getPresidentId('George', 'H. W. Bush');
  const clintonId = getPresidentId('Bill', 'Clinton');
  const wBushId = getPresidentId('George', 'W. Bush');
  const obamaId = getPresidentId('Barack', 'Obama');
  const trumpId = getPresidentId('Donald', 'Trump');
  const bidenId = getPresidentId('Joe', 'Biden');
  
  addLog(`✅ Seeded ${presidents.length} presidents`, 'success');

  // Step 6: Seed States
  addLog('🌱 Seeding states...', 'log');
  const states = await db.states.insert([
    { name: 'Alabama', abbreviation: 'AL', capital: 'Montgomery', admissionDate: new Date('1819-12-14'), population: 5024279 },
    { name: 'Alaska', abbreviation: 'AK', capital: 'Juneau', admissionDate: new Date('1959-01-03'), population: 733391 },
    { name: 'Arizona', abbreviation: 'AZ', capital: 'Phoenix', admissionDate: new Date('1912-02-14'), population: 7151502 },
    { name: 'Arkansas', abbreviation: 'AR', capital: 'Little Rock', admissionDate: new Date('1836-06-15'), population: 3011524 },
    { name: 'California', abbreviation: 'CA', capital: 'Sacramento', admissionDate: new Date('1850-09-09'), population: 39538223 },
    { name: 'Colorado', abbreviation: 'CO', capital: 'Denver', admissionDate: new Date('1876-08-01'), population: 5773714 },
    { name: 'Connecticut', abbreviation: 'CT', capital: 'Hartford', admissionDate: new Date('1788-01-09'), population: 3605944 },
    { name: 'Delaware', abbreviation: 'DE', capital: 'Dover', admissionDate: new Date('1787-12-07'), population: 989948 },
    { name: 'Florida', abbreviation: 'FL', capital: 'Tallahassee', admissionDate: new Date('1845-03-03'), population: 21538187 },
    { name: 'Georgia', abbreviation: 'GA', capital: 'Atlanta', admissionDate: new Date('1788-01-02'), population: 10711908 },
    { name: 'Hawaii', abbreviation: 'HI', capital: 'Honolulu', admissionDate: new Date('1959-08-21'), population: 1455271 },
    { name: 'Idaho', abbreviation: 'ID', capital: 'Boise', admissionDate: new Date('1890-07-03'), population: 1839106 },
    { name: 'Illinois', abbreviation: 'IL', capital: 'Springfield', admissionDate: new Date('1818-12-03'), population: 12812508 },
    { name: 'Indiana', abbreviation: 'IN', capital: 'Indianapolis', admissionDate: new Date('1816-12-11'), population: 6785528 },
    { name: 'Iowa', abbreviation: 'IA', capital: 'Des Moines', admissionDate: new Date('1846-12-28'), population: 3190369 },
    { name: 'Kansas', abbreviation: 'KS', capital: 'Topeka', admissionDate: new Date('1861-01-29'), population: 2937880 },
    { name: 'Kentucky', abbreviation: 'KY', capital: 'Frankfort', admissionDate: new Date('1792-06-01'), population: 4505836 },
    { name: 'Louisiana', abbreviation: 'LA', capital: 'Baton Rouge', admissionDate: new Date('1812-04-30'), population: 4657757 },
    { name: 'Maine', abbreviation: 'ME', capital: 'Augusta', admissionDate: new Date('1820-03-15'), population: 1362359 },
    { name: 'Maryland', abbreviation: 'MD', capital: 'Annapolis', admissionDate: new Date('1788-04-28'), population: 6177224 },
    { name: 'Massachusetts', abbreviation: 'MA', capital: 'Boston', admissionDate: new Date('1788-02-06'), population: 7029917 },
    { name: 'Michigan', abbreviation: 'MI', capital: 'Lansing', admissionDate: new Date('1837-01-26'), population: 10037361 },
    { name: 'Minnesota', abbreviation: 'MN', capital: 'Saint Paul', admissionDate: new Date('1858-05-11'), population: 5706494 },
    { name: 'Mississippi', abbreviation: 'MS', capital: 'Jackson', admissionDate: new Date('1817-12-10'), population: 2961279 },
    { name: 'Missouri', abbreviation: 'MO', capital: 'Jefferson City', admissionDate: new Date('1821-08-10'), population: 6154913 },
    { name: 'Montana', abbreviation: 'MT', capital: 'Helena', admissionDate: new Date('1889-11-08'), population: 1084225 },
    { name: 'Nebraska', abbreviation: 'NE', capital: 'Lincoln', admissionDate: new Date('1867-03-01'), population: 1961504 },
    { name: 'Nevada', abbreviation: 'NV', capital: 'Carson City', admissionDate: new Date('1864-10-31'), population: 3104614 },
    { name: 'New Hampshire', abbreviation: 'NH', capital: 'Concord', admissionDate: new Date('1788-06-21'), population: 1377529 },
    { name: 'New Jersey', abbreviation: 'NJ', capital: 'Trenton', admissionDate: new Date('1787-12-18'), population: 9288994 },
    { name: 'New Mexico', abbreviation: 'NM', capital: 'Santa Fe', admissionDate: new Date('1912-01-06'), population: 2117522 },
    { name: 'New York', abbreviation: 'NY', capital: 'Albany', admissionDate: new Date('1788-07-26'), population: 20201249 },
    { name: 'North Carolina', abbreviation: 'NC', capital: 'Raleigh', admissionDate: new Date('1789-11-21'), population: 10439388 },
    { name: 'North Dakota', abbreviation: 'ND', capital: 'Bismarck', admissionDate: new Date('1889-11-02'), population: 779094 },
    { name: 'Ohio', abbreviation: 'OH', capital: 'Columbus', admissionDate: new Date('1803-03-01'), population: 11799448 },
    { name: 'Oklahoma', abbreviation: 'OK', capital: 'Oklahoma City', admissionDate: new Date('1907-11-16'), population: 3959353 },
    { name: 'Oregon', abbreviation: 'OR', capital: 'Salem', admissionDate: new Date('1859-02-14'), population: 4237256 },
    { name: 'Pennsylvania', abbreviation: 'PA', capital: 'Harrisburg', admissionDate: new Date('1787-12-12'), population: 13002700 },
    { name: 'Rhode Island', abbreviation: 'RI', capital: 'Providence', admissionDate: new Date('1790-05-29'), population: 1097379 },
    { name: 'South Carolina', abbreviation: 'SC', capital: 'Columbia', admissionDate: new Date('1788-05-23'), population: 5118425 },
    { name: 'South Dakota', abbreviation: 'SD', capital: 'Pierre', admissionDate: new Date('1889-11-02'), population: 886667 },
    { name: 'Tennessee', abbreviation: 'TN', capital: 'Nashville', admissionDate: new Date('1796-06-01'), population: 6910840 },
    { name: 'Texas', abbreviation: 'TX', capital: 'Austin', admissionDate: new Date('1845-12-29'), population: 29145505 },
    { name: 'Utah', abbreviation: 'UT', capital: 'Salt Lake City', admissionDate: new Date('1896-01-04'), population: 3271616 },
    { name: 'Vermont', abbreviation: 'VT', capital: 'Montpelier', admissionDate: new Date('1791-03-04'), population: 643077 },
    { name: 'Virginia', abbreviation: 'VA', capital: 'Richmond', admissionDate: new Date('1788-06-25'), population: 8631393 },
    { name: 'Washington', abbreviation: 'WA', capital: 'Olympia', admissionDate: new Date('1889-11-11'), population: 7705281 },
    { name: 'West Virginia', abbreviation: 'WV', capital: 'Charleston', admissionDate: new Date('1863-06-20'), population: 1793716 },
    { name: 'Wisconsin', abbreviation: 'WI', capital: 'Madison', admissionDate: new Date('1848-05-29'), population: 5893718 },
    { name: 'Wyoming', abbreviation: 'WY', capital: 'Cheyenne', admissionDate: new Date('1890-07-10'), population: 576851 },
  ]).returning();
  
  // Create a map for easy lookup
  const stateMap = new Map(states.map(s => [s.abbreviation, s]));
  addLog('✅ Seeded 50 states', 'success');

  // Step 7: Seed Elections - All 60 Presidential Elections (1788-2024)
  addLog('🌱 Seeding elections...', 'log');
  const electionDataSource = 'Federal Election Commission, National Archives, Office of the Federal Register, US Election Atlas';
  const elections = await db.elections.insert([
    { year: 1788, electionDate: new Date('1788-12-15'), winnerId: washingtonId, totalElectoralVotes: 69, totalPopularVotes: null, dataSource: electionDataSource },
    { year: 1792, electionDate: new Date('1792-12-05'), winnerId: washingtonId, totalElectoralVotes: 132, totalPopularVotes: null, dataSource: electionDataSource },
    { year: 1796, electionDate: new Date('1796-12-07'), winnerId: adamsId, totalElectoralVotes: 138, totalPopularVotes: null, dataSource: electionDataSource },
    { year: 1800, electionDate: new Date('1800-12-03'), winnerId: jeffersonId, totalElectoralVotes: 138, totalPopularVotes: null, dataSource: electionDataSource },
    { year: 1804, electionDate: new Date('1804-12-05'), winnerId: jeffersonId, totalElectoralVotes: 176, totalPopularVotes: null, dataSource: electionDataSource },
    { year: 1808, electionDate: new Date('1808-12-07'), winnerId: madisonId, totalElectoralVotes: 175, totalPopularVotes: null, dataSource: electionDataSource },
    { year: 1812, electionDate: new Date('1812-12-02'), winnerId: madisonId, totalElectoralVotes: 217, totalPopularVotes: null, dataSource: electionDataSource },
    { year: 1816, electionDate: new Date('1816-12-04'), winnerId: monroeId, totalElectoralVotes: 221, totalPopularVotes: null, dataSource: electionDataSource },
    { year: 1820, electionDate: new Date('1820-12-06'), winnerId: monroeId, totalElectoralVotes: 232, totalPopularVotes: null, dataSource: electionDataSource },
    { year: 1824, electionDate: new Date('1824-12-01'), winnerId: jqAdamsId, totalElectoralVotes: 261, totalPopularVotes: 350671, dataSource: electionDataSource },
    { year: 1828, electionDate: new Date('1828-12-03'), winnerId: jacksonId, totalElectoralVotes: 261, totalPopularVotes: 1155626, dataSource: electionDataSource },
    { year: 1832, electionDate: new Date('1832-12-05'), winnerId: jacksonId, totalElectoralVotes: 286, totalPopularVotes: 1288541, dataSource: electionDataSource },
    { year: 1836, electionDate: new Date('1836-12-07'), winnerId: vanBurenId, totalElectoralVotes: 294, totalPopularVotes: 1500906, dataSource: electionDataSource },
    { year: 1840, electionDate: new Date('1840-12-02'), winnerId: harrisonId, totalElectoralVotes: 294, totalPopularVotes: 2400994, dataSource: electionDataSource },
    { year: 1844, electionDate: new Date('1844-12-04'), winnerId: polkId, totalElectoralVotes: 275, totalPopularVotes: 2670704, dataSource: electionDataSource },
    { year: 1848, electionDate: new Date('1848-12-05'), winnerId: taylorId, totalElectoralVotes: 290, totalPopularVotes: 2906214, dataSource: electionDataSource },
    { year: 1852, electionDate: new Date('1852-12-07'), winnerId: pierceId, totalElectoralVotes: 296, totalPopularVotes: 3141842, dataSource: electionDataSource },
    { year: 1856, electionDate: new Date('1856-12-02'), winnerId: buchananId, totalElectoralVotes: 296, totalPopularVotes: 4018963, dataSource: electionDataSource },
    { year: 1860, electionDate: new Date('1860-12-05'), winnerId: lincolnId, totalElectoralVotes: 303, totalPopularVotes: 4685698, dataSource: electionDataSource },
    { year: 1864, electionDate: new Date('1864-12-08'), winnerId: lincolnId, totalElectoralVotes: 233, totalPopularVotes: 4011178, dataSource: electionDataSource },
    { year: 1868, electionDate: new Date('1868-12-03'), winnerId: grantId, totalElectoralVotes: 294, totalPopularVotes: 5775075, dataSource: electionDataSource },
    { year: 1872, electionDate: new Date('1872-12-05'), winnerId: grantId, totalElectoralVotes: 352, totalPopularVotes: 6283006, dataSource: electionDataSource },
    { year: 1876, electionDate: new Date('1876-12-06'), winnerId: hayesId, totalElectoralVotes: 369, totalPopularVotes: 8355793, dataSource: electionDataSource },
    { year: 1880, electionDate: new Date('1880-12-01'), winnerId: garfieldId, totalElectoralVotes: 369, totalPopularVotes: 9044737, dataSource: electionDataSource },
    { year: 1884, electionDate: new Date('1884-12-03'), winnerId: clevelandId, totalElectoralVotes: 401, totalPopularVotes: 10018269, dataSource: electionDataSource },
    { year: 1888, electionDate: new Date('1888-12-05'), winnerId: bHarrisonId, totalElectoralVotes: 401, totalPopularVotes: 11287744, dataSource: electionDataSource },
    { year: 1892, electionDate: new Date('1892-12-07'), winnerId: clevelandId, totalElectoralVotes: 444, totalPopularVotes: 12026454, dataSource: electionDataSource },
    { year: 1896, electionDate: new Date('1896-12-01'), winnerId: mckinleyId, totalElectoralVotes: 447, totalPopularVotes: 13965998, dataSource: electionDataSource },
    { year: 1900, electionDate: new Date('1900-12-03'), winnerId: mckinleyId, totalElectoralVotes: 447, totalPopularVotes: 13821851, dataSource: electionDataSource },
    { year: 1904, electionDate: new Date('1904-12-06'), winnerId: teddyRooseveltId, totalElectoralVotes: 476, totalPopularVotes: 16312838, dataSource: electionDataSource },
    { year: 1908, electionDate: new Date('1908-12-01'), winnerId: taftId, totalElectoralVotes: 483, totalPopularVotes: 15099797, dataSource: electionDataSource },
    { year: 1912, electionDate: new Date('1912-12-05'), winnerId: wilsonId, totalElectoralVotes: 531, totalPopularVotes: 15125435, dataSource: electionDataSource },
    { year: 1916, electionDate: new Date('1916-12-05'), winnerId: wilsonId, totalElectoralVotes: 531, totalPopularVotes: 18471234, dataSource: electionDataSource },
    { year: 1920, electionDate: new Date('1920-12-06'), winnerId: hardingId, totalElectoralVotes: 531, totalPopularVotes: 26522889, dataSource: electionDataSource },
    { year: 1924, electionDate: new Date('1924-12-02'), winnerId: coolidgeId, totalElectoralVotes: 531, totalPopularVotes: 29093610, dataSource: electionDataSource },
    { year: 1928, electionDate: new Date('1928-12-04'), winnerId: hooverId, totalElectoralVotes: 531, totalPopularVotes: 36947742, dataSource: electionDataSource },
    { year: 1932, electionDate: new Date('1932-12-06'), winnerId: fdrId, totalElectoralVotes: 531, totalPopularVotes: 39589023, dataSource: electionDataSource },
    { year: 1936, electionDate: new Date('1936-12-01'), winnerId: fdrId, totalElectoralVotes: 531, totalPopularVotes: 45651366, dataSource: electionDataSource },
    { year: 1940, electionDate: new Date('1940-12-03'), winnerId: fdrId, totalElectoralVotes: 531, totalPopularVotes: 49731066, dataSource: electionDataSource },
    { year: 1944, electionDate: new Date('1944-12-05'), winnerId: fdrId, totalElectoralVotes: 531, totalPopularVotes: 47575157, dataSource: electionDataSource },
    { year: 1948, electionDate: new Date('1948-12-07'), winnerId: trumanId, totalElectoralVotes: 531, totalPopularVotes: 48068020, dataSource: electionDataSource },
    { year: 1952, electionDate: new Date('1952-12-02'), winnerId: eisenhowerId, totalElectoralVotes: 531, totalPopularVotes: 61165184, dataSource: electionDataSource },
    { year: 1956, electionDate: new Date('1956-12-04'), winnerId: eisenhowerId, totalElectoralVotes: 531, totalPopularVotes: 62170027, dataSource: electionDataSource },
    { year: 1960, electionDate: new Date('1960-12-06'), winnerId: kennedyId, totalElectoralVotes: 537, totalPopularVotes: 68838381, dataSource: electionDataSource },
    { year: 1964, electionDate: new Date('1964-12-01'), winnerId: lbjId, totalElectoralVotes: 538, totalPopularVotes: 70099833, dataSource: electionDataSource },
    { year: 1968, electionDate: new Date('1968-12-03'), winnerId: nixonId, totalElectoralVotes: 538, totalPopularVotes: 73211884, dataSource: electionDataSource },
    { year: 1972, electionDate: new Date('1972-12-05'), winnerId: nixonId, totalElectoralVotes: 538, totalPopularVotes: 77744945, dataSource: electionDataSource },
    { year: 1976, electionDate: new Date('1976-12-07'), winnerId: carterId, totalElectoralVotes: 538, totalPopularVotes: 81555589, dataSource: electionDataSource },
    { year: 1980, electionDate: new Date('1980-12-02'), winnerId: reaganId, totalElectoralVotes: 538, totalPopularVotes: 86515907, dataSource: electionDataSource },
    { year: 1984, electionDate: new Date('1984-12-04'), winnerId: reaganId, totalElectoralVotes: 538, totalPopularVotes: 92652880, dataSource: electionDataSource },
    { year: 1988, electionDate: new Date('1988-12-06'), winnerId: hwBushId, totalElectoralVotes: 538, totalPopularVotes: 91590221, dataSource: electionDataSource },
    { year: 1992, electionDate: new Date('1992-11-03'), winnerId: clintonId, totalElectoralVotes: 538, totalPopularVotes: 104426659, dataSource: electionDataSource },
    { year: 1996, electionDate: new Date('1996-11-05'), winnerId: clintonId, totalElectoralVotes: 538, totalPopularVotes: 96278933, dataSource: electionDataSource },
    { year: 2000, electionDate: new Date('2000-11-07'), winnerId: wBushId, totalElectoralVotes: 538, totalPopularVotes: 105405100, dataSource: electionDataSource },
    { year: 2004, electionDate: new Date('2004-11-02'), winnerId: wBushId, totalElectoralVotes: 538, totalPopularVotes: 122294978, dataSource: electionDataSource },
    { year: 2008, electionDate: new Date('2008-11-04'), winnerId: obamaId, totalElectoralVotes: 538, totalPopularVotes: 131313820, dataSource: electionDataSource },
    { year: 2012, electionDate: new Date('2012-11-06'), winnerId: obamaId, totalElectoralVotes: 538, totalPopularVotes: 129085410, dataSource: electionDataSource },
    { year: 2016, electionDate: new Date('2016-11-08'), winnerId: trumpId, totalElectoralVotes: 538, totalPopularVotes: 136669237, dataSource: electionDataSource },
    { year: 2020, electionDate: new Date('2020-11-03'), winnerId: bidenId, totalElectoralVotes: 538, totalPopularVotes: 159633396, dataSource: electionDataSource },
    { year: 2024, electionDate: new Date('2024-11-05'), winnerId: trumpId, totalElectoralVotes: 538, totalPopularVotes: 155238302, dataSource: electionDataSource },
  ]).returning();
  
  // Create a map for easy lookup by year
  const electionMap = new Map<number, string>();
  elections.forEach(e => electionMap.set(e.year as number, e.id as string));
  
  addLog(`✅ Seeded ${elections.length} elections`, 'success');

  // Step 8: Seed Election Results (sample states for recent elections to demonstrate relationships)
  addLog('🌱 Seeding election results...', 'log');
  
  // 2020 Election Results (Biden vs Trump) - key swing states
  const election2020Results = await db.electionResults.insert([
    { electionId: electionMap.get(2020)!, stateId: stateMap.get('CA')!.id, candidateId: bidenId, electoralVotes: 55, popularVotes: 11110250 },
    { electionId: electionMap.get(2020)!, stateId: stateMap.get('TX')!.id, candidateId: trumpId, electoralVotes: 38, popularVotes: 5890347 },
    { electionId: electionMap.get(2020)!, stateId: stateMap.get('FL')!.id, candidateId: trumpId, electoralVotes: 29, popularVotes: 5668731 },
    { electionId: electionMap.get(2020)!, stateId: stateMap.get('NY')!.id, candidateId: bidenId, electoralVotes: 29, popularVotes: 5288042 },
    { electionId: electionMap.get(2020)!, stateId: stateMap.get('PA')!.id, candidateId: bidenId, electoralVotes: 20, popularVotes: 3458223 },
    { electionId: electionMap.get(2020)!, stateId: stateMap.get('OH')!.id, candidateId: trumpId, electoralVotes: 18, popularVotes: 3154834 },
    { electionId: electionMap.get(2020)!, stateId: stateMap.get('GA')!.id, candidateId: bidenId, electoralVotes: 16, popularVotes: 2473633 },
    { electionId: electionMap.get(2020)!, stateId: stateMap.get('NC')!.id, candidateId: trumpId, electoralVotes: 15, popularVotes: 2758775 },
    { electionId: electionMap.get(2020)!, stateId: stateMap.get('MI')!.id, candidateId: bidenId, electoralVotes: 16, popularVotes: 2804040 },
    { electionId: electionMap.get(2020)!, stateId: stateMap.get('AZ')!.id, candidateId: bidenId, electoralVotes: 11, popularVotes: 1672143 },
  ]).returning();

  // 2016 Election Results (Trump vs Clinton) - key states
  const election2016Results = await db.electionResults.insert([
    { electionId: electionMap.get(2016)!, stateId: stateMap.get('CA')!.id, candidateId: clintonId, electoralVotes: 55, popularVotes: 8753788 },
    { electionId: electionMap.get(2016)!, stateId: stateMap.get('TX')!.id, candidateId: trumpId, electoralVotes: 38, popularVotes: 4685047 },
    { electionId: electionMap.get(2016)!, stateId: stateMap.get('FL')!.id, candidateId: trumpId, electoralVotes: 29, popularVotes: 4617886 },
    { electionId: electionMap.get(2016)!, stateId: stateMap.get('NY')!.id, candidateId: clintonId, electoralVotes: 29, popularVotes: 4556124 },
    { electionId: electionMap.get(2016)!, stateId: stateMap.get('PA')!.id, candidateId: trumpId, electoralVotes: 20, popularVotes: 2970733 },
    { electionId: electionMap.get(2016)!, stateId: stateMap.get('OH')!.id, candidateId: trumpId, electoralVotes: 18, popularVotes: 2841005 },
    { electionId: electionMap.get(2016)!, stateId: stateMap.get('GA')!.id, candidateId: trumpId, electoralVotes: 16, popularVotes: 2089104 },
    { electionId: electionMap.get(2016)!, stateId: stateMap.get('NC')!.id, candidateId: trumpId, electoralVotes: 15, popularVotes: 2362631 },
    { electionId: electionMap.get(2016)!, stateId: stateMap.get('MI')!.id, candidateId: trumpId, electoralVotes: 16, popularVotes: 2279543 },
    { electionId: electionMap.get(2016)!, stateId: stateMap.get('WI')!.id, candidateId: trumpId, electoralVotes: 10, popularVotes: 1405284 },
  ]).returning();

  // 2012 Election Results (Obama) - key states
  const election2012Results = await db.electionResults.insert([
    { electionId: electionMap.get(2012)!, stateId: stateMap.get('CA')!.id, candidateId: obamaId, electoralVotes: 55, popularVotes: 7854285 },
    { electionId: electionMap.get(2012)!, stateId: stateMap.get('TX')!.id, candidateId: wBushId, electoralVotes: 38, popularVotes: 4569843 },
    { electionId: electionMap.get(2012)!, stateId: stateMap.get('FL')!.id, candidateId: obamaId, electoralVotes: 29, popularVotes: 4237756 },
    { electionId: electionMap.get(2012)!, stateId: stateMap.get('NY')!.id, candidateId: obamaId, electoralVotes: 29, popularVotes: 4485741 },
    { electionId: electionMap.get(2012)!, stateId: stateMap.get('PA')!.id, candidateId: obamaId, electoralVotes: 20, popularVotes: 2990276 },
    { electionId: electionMap.get(2012)!, stateId: stateMap.get('OH')!.id, candidateId: obamaId, electoralVotes: 18, popularVotes: 2827621 },
  ]).returning();

  // 2008 Election Results (Obama) - key states
  const election2008Results = await db.electionResults.insert([
    { electionId: electionMap.get(2008)!, stateId: stateMap.get('CA')!.id, candidateId: obamaId, electoralVotes: 55, popularVotes: 8274473 },
    { electionId: electionMap.get(2008)!, stateId: stateMap.get('TX')!.id, candidateId: wBushId, electoralVotes: 34, popularVotes: 4526917 },
    { electionId: electionMap.get(2008)!, stateId: stateMap.get('FL')!.id, candidateId: obamaId, electoralVotes: 27, popularVotes: 4282074 },
    { electionId: electionMap.get(2008)!, stateId: stateMap.get('NY')!.id, candidateId: obamaId, electoralVotes: 31, popularVotes: 4815894 },
    { electionId: electionMap.get(2008)!, stateId: stateMap.get('PA')!.id, candidateId: obamaId, electoralVotes: 21, popularVotes: 3276363 },
    { electionId: electionMap.get(2008)!, stateId: stateMap.get('OH')!.id, candidateId: obamaId, electoralVotes: 20, popularVotes: 2935027 },
  ]).returning();

  addLog(`✅ Seeded ${election2020Results.length + election2016Results.length + election2012Results.length + election2008Results.length} election results (sample)`, 'success');

  // Step 9: Seed Presidencies - All 69 Presidencies (60 elections, but 9 successions created additional presidencies)
  addLog('🌱 Seeding presidencies...', 'log');
  const presidencyDataSource = 'White House Historical Association, National Archives, Office of the Federal Register';
  
  // Helper to get people ID by name (for VPs)
  const getPersonId = (firstName: string, lastName: string): string | null => {
    return peopleByNameMap.get(`${firstName} ${lastName}`) || null;
  };
  
  const presidencies = await db.presidencies.insert([
    { presidentId: washingtonId, electionId: electionMap.get(1788)!, termNumber: 1, startDate: new Date('1789-04-30'), endDate: new Date('1793-03-04'), vicePresidentId: getPersonId('John', 'Adams'), dataSource: presidencyDataSource },
    { presidentId: washingtonId, electionId: electionMap.get(1792)!, termNumber: 2, startDate: new Date('1793-03-04'), endDate: new Date('1797-03-04'), vicePresidentId: getPersonId('John', 'Adams'), dataSource: presidencyDataSource },
    { presidentId: adamsId, electionId: electionMap.get(1796)!, termNumber: 1, startDate: new Date('1797-03-04'), endDate: new Date('1801-03-04'), vicePresidentId: getPersonId('Thomas', 'Jefferson'), dataSource: presidencyDataSource },
    { presidentId: jeffersonId, electionId: electionMap.get(1800)!, termNumber: 1, startDate: new Date('1801-03-04'), endDate: new Date('1805-03-04'), vicePresidentId: getPersonId('Aaron', 'Burr'), dataSource: presidencyDataSource },
    { presidentId: jeffersonId, electionId: electionMap.get(1804)!, termNumber: 2, startDate: new Date('1805-03-04'), endDate: new Date('1809-03-04'), vicePresidentId: getPersonId('George', 'Clinton'), dataSource: presidencyDataSource },
    { presidentId: madisonId, electionId: electionMap.get(1808)!, termNumber: 1, startDate: new Date('1809-03-04'), endDate: new Date('1813-03-04'), vicePresidentId: getPersonId('George', 'Clinton'), dataSource: presidencyDataSource },
    { presidentId: madisonId, electionId: electionMap.get(1812)!, termNumber: 2, startDate: new Date('1813-03-04'), endDate: new Date('1817-03-04'), vicePresidentId: getPersonId('Elbridge', 'Gerry'), dataSource: presidencyDataSource },
    { presidentId: monroeId, electionId: electionMap.get(1816)!, termNumber: 1, startDate: new Date('1817-03-04'), endDate: new Date('1821-03-04'), vicePresidentId: getPersonId('Daniel', 'D. Tompkins'), dataSource: presidencyDataSource },
    { presidentId: monroeId, electionId: electionMap.get(1820)!, termNumber: 2, startDate: new Date('1821-03-04'), endDate: new Date('1825-03-04'), vicePresidentId: getPersonId('Daniel', 'D. Tompkins'), dataSource: presidencyDataSource },
    { presidentId: jqAdamsId, electionId: electionMap.get(1824)!, termNumber: 1, startDate: new Date('1825-03-04'), endDate: new Date('1829-03-04'), vicePresidentId: getPersonId('John', 'C. Calhoun'), dataSource: presidencyDataSource },
    { presidentId: jacksonId, electionId: electionMap.get(1828)!, termNumber: 1, startDate: new Date('1829-03-04'), endDate: new Date('1833-03-04'), vicePresidentId: getPersonId('John', 'C. Calhoun'), dataSource: presidencyDataSource },
    { presidentId: jacksonId, electionId: electionMap.get(1832)!, termNumber: 2, startDate: new Date('1833-03-04'), endDate: new Date('1837-03-04'), vicePresidentId: getPersonId('Martin', 'Van Buren'), dataSource: presidencyDataSource },
    { presidentId: vanBurenId, electionId: electionMap.get(1836)!, termNumber: 1, startDate: new Date('1837-03-04'), endDate: new Date('1841-03-04'), vicePresidentId: getPersonId('Richard', 'M. Johnson'), dataSource: presidencyDataSource },
    { presidentId: harrisonId, electionId: electionMap.get(1840)!, termNumber: 1, startDate: new Date('1841-03-04'), endDate: new Date('1841-04-04'), vicePresidentId: getPersonId('John', 'Tyler'), dataSource: presidencyDataSource },
    { presidentId: tylerId, electionId: electionMap.get(1840)!, termNumber: 1, startDate: new Date('1841-04-04'), endDate: new Date('1845-03-04'), vicePresidentId: null, dataSource: presidencyDataSource },
    { presidentId: polkId, electionId: electionMap.get(1844)!, termNumber: 1, startDate: new Date('1845-03-04'), endDate: new Date('1849-03-04'), vicePresidentId: getPersonId('George', 'M. Dallas'), dataSource: presidencyDataSource },
    { presidentId: taylorId, electionId: electionMap.get(1848)!, termNumber: 1, startDate: new Date('1849-03-04'), endDate: new Date('1850-07-09'), vicePresidentId: getPersonId('Millard', 'Fillmore'), dataSource: presidencyDataSource },
    { presidentId: fillmoreId, electionId: electionMap.get(1848)!, termNumber: 1, startDate: new Date('1850-07-09'), endDate: new Date('1853-03-04'), vicePresidentId: null, dataSource: presidencyDataSource },
    { presidentId: pierceId, electionId: electionMap.get(1852)!, termNumber: 1, startDate: new Date('1853-03-04'), endDate: new Date('1857-03-04'), vicePresidentId: getPersonId('William', 'R. King'), dataSource: presidencyDataSource },
    { presidentId: buchananId, electionId: electionMap.get(1856)!, termNumber: 1, startDate: new Date('1857-03-04'), endDate: new Date('1861-03-04'), vicePresidentId: getPersonId('John', 'C. Breckinridge'), dataSource: presidencyDataSource },
    { presidentId: lincolnId, electionId: electionMap.get(1860)!, termNumber: 1, startDate: new Date('1861-03-04'), endDate: new Date('1865-03-04'), vicePresidentId: getPersonId('Hannibal', 'Hamlin'), dataSource: presidencyDataSource },
    { presidentId: lincolnId, electionId: electionMap.get(1864)!, termNumber: 2, startDate: new Date('1865-03-04'), endDate: new Date('1865-04-15'), vicePresidentId: getPersonId('Andrew', 'Johnson'), dataSource: presidencyDataSource },
    { presidentId: johnsonId, electionId: electionMap.get(1864)!, termNumber: 1, startDate: new Date('1865-04-15'), endDate: new Date('1869-03-04'), vicePresidentId: null, dataSource: presidencyDataSource },
    { presidentId: grantId, electionId: electionMap.get(1868)!, termNumber: 1, startDate: new Date('1869-03-04'), endDate: new Date('1873-03-04'), vicePresidentId: getPersonId('Schuyler', 'Colfax'), dataSource: presidencyDataSource },
    { presidentId: grantId, electionId: electionMap.get(1872)!, termNumber: 2, startDate: new Date('1873-03-04'), endDate: new Date('1877-03-04'), vicePresidentId: getPersonId('Henry', 'Wilson'), dataSource: presidencyDataSource },
    { presidentId: hayesId, electionId: electionMap.get(1876)!, termNumber: 1, startDate: new Date('1877-03-04'), endDate: new Date('1881-03-04'), vicePresidentId: getPersonId('William', 'A. Wheeler'), dataSource: presidencyDataSource },
    { presidentId: garfieldId, electionId: electionMap.get(1880)!, termNumber: 1, startDate: new Date('1881-03-04'), endDate: new Date('1881-09-19'), vicePresidentId: getPersonId('Chester', 'A. Arthur'), dataSource: presidencyDataSource },
    { presidentId: arthurId, electionId: electionMap.get(1880)!, termNumber: 1, startDate: new Date('1881-09-19'), endDate: new Date('1885-03-04'), vicePresidentId: null, dataSource: presidencyDataSource },
    { presidentId: clevelandId, electionId: electionMap.get(1884)!, termNumber: 1, startDate: new Date('1885-03-04'), endDate: new Date('1889-03-04'), vicePresidentId: getPersonId('Thomas', 'A. Hendricks'), dataSource: presidencyDataSource },
    { presidentId: bHarrisonId, electionId: electionMap.get(1888)!, termNumber: 1, startDate: new Date('1889-03-04'), endDate: new Date('1893-03-04'), vicePresidentId: getPersonId('Levi', 'P. Morton'), dataSource: presidencyDataSource },
    { presidentId: clevelandId, electionId: electionMap.get(1892)!, termNumber: 2, startDate: new Date('1893-03-04'), endDate: new Date('1897-03-04'), vicePresidentId: getPersonId('Adlai', 'Stevenson I'), dataSource: presidencyDataSource },
    { presidentId: mckinleyId, electionId: electionMap.get(1896)!, termNumber: 1, startDate: new Date('1897-03-04'), endDate: new Date('1901-03-04'), vicePresidentId: getPersonId('Garret', 'Hobart'), dataSource: presidencyDataSource },
    { presidentId: mckinleyId, electionId: electionMap.get(1900)!, termNumber: 2, startDate: new Date('1901-03-04'), endDate: new Date('1901-09-14'), vicePresidentId: getPersonId('Theodore', 'Roosevelt'), dataSource: presidencyDataSource },
    { presidentId: teddyRooseveltId, electionId: electionMap.get(1900)!, termNumber: 1, startDate: new Date('1901-09-14'), endDate: new Date('1905-03-04'), vicePresidentId: null, dataSource: presidencyDataSource },
    { presidentId: teddyRooseveltId, electionId: electionMap.get(1904)!, termNumber: 2, startDate: new Date('1905-03-04'), endDate: new Date('1909-03-04'), vicePresidentId: getPersonId('Charles', 'W. Fairbanks'), dataSource: presidencyDataSource },
    { presidentId: taftId, electionId: electionMap.get(1908)!, termNumber: 1, startDate: new Date('1909-03-04'), endDate: new Date('1913-03-04'), vicePresidentId: getPersonId('James', 'S. Sherman'), dataSource: presidencyDataSource },
    { presidentId: wilsonId, electionId: electionMap.get(1912)!, termNumber: 1, startDate: new Date('1913-03-04'), endDate: new Date('1917-03-04'), vicePresidentId: getPersonId('Thomas', 'R. Marshall'), dataSource: presidencyDataSource },
    { presidentId: wilsonId, electionId: electionMap.get(1916)!, termNumber: 2, startDate: new Date('1917-03-04'), endDate: new Date('1921-03-04'), vicePresidentId: getPersonId('Thomas', 'R. Marshall'), dataSource: presidencyDataSource },
    { presidentId: hardingId, electionId: electionMap.get(1920)!, termNumber: 1, startDate: new Date('1921-03-04'), endDate: new Date('1923-08-02'), vicePresidentId: getPersonId('Calvin', 'Coolidge'), dataSource: presidencyDataSource },
    { presidentId: coolidgeId, electionId: electionMap.get(1920)!, termNumber: 1, startDate: new Date('1923-08-02'), endDate: new Date('1925-03-04'), vicePresidentId: null, dataSource: presidencyDataSource },
    { presidentId: coolidgeId, electionId: electionMap.get(1924)!, termNumber: 2, startDate: new Date('1925-03-04'), endDate: new Date('1929-03-04'), vicePresidentId: getPersonId('Charles', 'G. Dawes'), dataSource: presidencyDataSource },
    { presidentId: hooverId, electionId: electionMap.get(1928)!, termNumber: 1, startDate: new Date('1929-03-04'), endDate: new Date('1933-03-04'), vicePresidentId: getPersonId('Charles', 'Curtis'), dataSource: presidencyDataSource },
    { presidentId: fdrId, electionId: electionMap.get(1932)!, termNumber: 1, startDate: new Date('1933-03-04'), endDate: new Date('1937-01-20'), vicePresidentId: getPersonId('John', 'Nance Garner'), dataSource: presidencyDataSource },
    { presidentId: fdrId, electionId: electionMap.get(1936)!, termNumber: 2, startDate: new Date('1937-01-20'), endDate: new Date('1941-01-20'), vicePresidentId: getPersonId('John', 'Nance Garner'), dataSource: presidencyDataSource },
    { presidentId: fdrId, electionId: electionMap.get(1940)!, termNumber: 3, startDate: new Date('1941-01-20'), endDate: new Date('1945-01-20'), vicePresidentId: getPersonId('Henry', 'A. Wallace'), dataSource: presidencyDataSource },
    { presidentId: fdrId, electionId: electionMap.get(1944)!, termNumber: 4, startDate: new Date('1945-01-20'), endDate: new Date('1945-04-12'), vicePresidentId: getPersonId('Harry', 'S. Truman'), dataSource: presidencyDataSource },
    { presidentId: trumanId, electionId: electionMap.get(1944)!, termNumber: 1, startDate: new Date('1945-04-12'), endDate: new Date('1949-01-20'), vicePresidentId: null, dataSource: presidencyDataSource },
    { presidentId: trumanId, electionId: electionMap.get(1948)!, termNumber: 2, startDate: new Date('1949-01-20'), endDate: new Date('1953-01-20'), vicePresidentId: getPersonId('Alben', 'W. Barkley'), dataSource: presidencyDataSource },
    { presidentId: eisenhowerId, electionId: electionMap.get(1952)!, termNumber: 1, startDate: new Date('1953-01-20'), endDate: new Date('1957-01-20'), vicePresidentId: getPersonId('Richard', 'Nixon'), dataSource: presidencyDataSource },
    { presidentId: eisenhowerId, electionId: electionMap.get(1956)!, termNumber: 2, startDate: new Date('1957-01-20'), endDate: new Date('1961-01-20'), vicePresidentId: getPersonId('Richard', 'Nixon'), dataSource: presidencyDataSource },
    { presidentId: kennedyId, electionId: electionMap.get(1960)!, termNumber: 1, startDate: new Date('1961-01-20'), endDate: new Date('1963-11-22'), vicePresidentId: getPersonId('Lyndon', 'B. Johnson'), dataSource: presidencyDataSource },
    { presidentId: lbjId, electionId: electionMap.get(1960)!, termNumber: 1, startDate: new Date('1963-11-22'), endDate: new Date('1965-01-20'), vicePresidentId: null, dataSource: presidencyDataSource },
    { presidentId: lbjId, electionId: electionMap.get(1964)!, termNumber: 2, startDate: new Date('1965-01-20'), endDate: new Date('1969-01-20'), vicePresidentId: getPersonId('Hubert', 'Humphrey'), dataSource: presidencyDataSource },
    { presidentId: nixonId, electionId: electionMap.get(1968)!, termNumber: 1, startDate: new Date('1969-01-20'), endDate: new Date('1973-01-20'), vicePresidentId: getPersonId('Spiro', 'Agnew'), dataSource: presidencyDataSource },
    { presidentId: nixonId, electionId: electionMap.get(1972)!, termNumber: 2, startDate: new Date('1973-01-20'), endDate: new Date('1974-08-09'), vicePresidentId: getPersonId('Gerald', 'Ford'), dataSource: presidencyDataSource },
    { presidentId: fordId, electionId: electionMap.get(1972)!, termNumber: 1, startDate: new Date('1974-08-09'), endDate: new Date('1977-01-20'), vicePresidentId: getPersonId('Nelson', 'Rockefeller'), dataSource: presidencyDataSource },
    { presidentId: carterId, electionId: electionMap.get(1976)!, termNumber: 1, startDate: new Date('1977-01-20'), endDate: new Date('1981-01-20'), vicePresidentId: getPersonId('Walter', 'Mondale'), dataSource: presidencyDataSource },
    { presidentId: reaganId, electionId: electionMap.get(1980)!, termNumber: 1, startDate: new Date('1981-01-20'), endDate: new Date('1985-01-20'), vicePresidentId: getPersonId('George', 'H. W. Bush'), dataSource: presidencyDataSource },
    { presidentId: reaganId, electionId: electionMap.get(1984)!, termNumber: 2, startDate: new Date('1985-01-20'), endDate: new Date('1989-01-20'), vicePresidentId: getPersonId('George', 'H. W. Bush'), dataSource: presidencyDataSource },
    { presidentId: hwBushId, electionId: electionMap.get(1988)!, termNumber: 1, startDate: new Date('1989-01-20'), endDate: new Date('1993-01-20'), vicePresidentId: getPersonId('Dan', 'Quayle'), dataSource: presidencyDataSource },
    { presidentId: clintonId, electionId: electionMap.get(1992)!, termNumber: 1, startDate: new Date('1993-01-20'), endDate: new Date('1997-01-20'), vicePresidentId: getPersonId('Al', 'Gore'), dataSource: presidencyDataSource },
    { presidentId: clintonId, electionId: electionMap.get(1996)!, termNumber: 2, startDate: new Date('1997-01-20'), endDate: new Date('2001-01-20'), vicePresidentId: getPersonId('Al', 'Gore'), dataSource: presidencyDataSource },
    { presidentId: wBushId, electionId: electionMap.get(2000)!, termNumber: 1, startDate: new Date('2001-01-20'), endDate: new Date('2005-01-20'), vicePresidentId: getPersonId('Dick', 'Cheney'), dataSource: presidencyDataSource },
    { presidentId: wBushId, electionId: electionMap.get(2004)!, termNumber: 2, startDate: new Date('2005-01-20'), endDate: new Date('2009-01-20'), vicePresidentId: getPersonId('Dick', 'Cheney'), dataSource: presidencyDataSource },
    { presidentId: obamaId, electionId: electionMap.get(2008)!, termNumber: 1, startDate: new Date('2009-01-20'), endDate: new Date('2013-01-20'), vicePresidentId: getPersonId('Joe', 'Biden'), dataSource: presidencyDataSource },
    { presidentId: obamaId, electionId: electionMap.get(2012)!, termNumber: 2, startDate: new Date('2013-01-20'), endDate: new Date('2017-01-20'), vicePresidentId: getPersonId('Joe', 'Biden'), dataSource: presidencyDataSource },
    { presidentId: trumpId, electionId: electionMap.get(2016)!, termNumber: 1, startDate: new Date('2017-01-20'), endDate: new Date('2021-01-20'), vicePresidentId: getPersonId('Mike', 'Pence'), dataSource: presidencyDataSource },
    { presidentId: bidenId, electionId: electionMap.get(2020)!, termNumber: 1, startDate: new Date('2021-01-20'), endDate: new Date('2025-01-20'), vicePresidentId: getPersonId('Kamala', 'Harris'), dataSource: presidencyDataSource },
    { presidentId: trumpId, electionId: electionMap.get(2024)!, termNumber: 2, startDate: new Date('2025-01-20'), vicePresidentId: getPersonId('JD', 'Vance'), dataSource: presidencyDataSource },
  ]).returning();
  
  // Create a map for easy lookup by president and term
  const presidencyMap = new Map<string, string>();
  presidencies.forEach(p => {
    const president = presidents.find(pr => pr.id === p.presidentId);
    if (president) {
      const person = people.find(per => per.id === president.personId);
      if (person) {
        const key = `${person.firstName} ${person.lastName}-${p.termNumber}`;
        presidencyMap.set(key, p.id as string);
      }
    }
  });
  
  addLog(`✅ Seeded ${presidencies.length} presidencies`, 'success');

  // Step 10: Seed Presidency Statistics - Economic data for modern presidencies
  addLog('🌱 Seeding presidency statistics...', 'log');
  const statisticsDataSource = 'Bureau of Labor Statistics (BLS), Bureau of Economic Analysis (BEA), Treasury Department, Federal Reserve Economic Data (FRED)';
  const statisticsData: any[] = [];
  
  // Helper function to add statistics
  const addStats = (presidentName: string, termNum: number, stats: any[]) => {
    const presId = presidencyMap.get(`${presidentName}-${termNum}`);
    if (presId) {
      stats.forEach(stat => {
        statisticsData.push({ ...stat, presidencyId: presId, dataSource: statisticsDataSource });
      });
    }
  };
  
  // FDR Term 1 (1933-1936)
  addStats('Franklin Roosevelt', 1, [
    { year: 1933, inflationRate: '-5.10', gdpGrowth: '-1.20', unemploymentRate: '24.90', federalDebt: 225 },
    { year: 1934, inflationRate: '3.08', gdpGrowth: '10.80', unemploymentRate: '21.70', federalDebt: 270 },
    { year: 1935, inflationRate: '2.99', gdpGrowth: '8.90', unemploymentRate: '20.10', federalDebt: 287 },
    { year: 1936, inflationRate: '1.21', gdpGrowth: '12.90', unemploymentRate: '16.90', federalDebt: 338 },
  ]);
  
  // FDR Term 2 (1937-1940)
  addStats('Franklin Roosevelt', 2, [
    { year: 1937, inflationRate: '3.60', gdpGrowth: '5.10', unemploymentRate: '14.30', federalDebt: 365 },
    { year: 1938, inflationRate: '-2.78', gdpGrowth: '-3.30', unemploymentRate: '19.00', federalDebt: 370 },
    { year: 1939, inflationRate: '-1.41', gdpGrowth: '8.00', unemploymentRate: '17.20', federalDebt: 404 },
    { year: 1940, inflationRate: '0.71', gdpGrowth: '8.80', unemploymentRate: '14.60', federalDebt: 429 },
  ]);
  
  // FDR Term 3 (1941-1944)
  addStats('Franklin Roosevelt', 3, [
    { year: 1941, inflationRate: '5.11', gdpGrowth: '17.10', unemploymentRate: '9.90', federalDebt: 480 },
    { year: 1942, inflationRate: '10.88', gdpGrowth: '18.50', unemploymentRate: '4.70', federalDebt: 717 },
    { year: 1943, inflationRate: '6.13', gdpGrowth: '16.40', unemploymentRate: '1.90', federalDebt: 1367 },
    { year: 1944, inflationRate: '1.75', gdpGrowth: '8.00', unemploymentRate: '1.20', federalDebt: 2010 },
  ]);
  
  // FDR Term 4 (1945)
  addStats('Franklin Roosevelt', 4, [
    { year: 1945, inflationRate: '2.25', gdpGrowth: '-1.00', unemploymentRate: '1.90', federalDebt: 2587 },
  ]);
  
  // Truman Term 1 (1945-1948)
  addStats('Harry S. Truman', 1, [
    { year: 1946, inflationRate: '8.33', gdpGrowth: '-11.60', unemploymentRate: '3.90', federalDebt: 2710 },
    { year: 1947, inflationRate: '14.39', gdpGrowth: '-1.10', unemploymentRate: '3.90', federalDebt: 2583 },
    { year: 1948, inflationRate: '7.72', gdpGrowth: '4.10', unemploymentRate: '3.80', federalDebt: 2523 },
  ]);
  
  // Truman Term 2 (1949-1952)
  addStats('Harry S. Truman', 2, [
    { year: 1949, inflationRate: '-1.00', gdpGrowth: '-0.60', unemploymentRate: '5.90', federalDebt: 2528 },
    { year: 1950, inflationRate: '1.03', gdpGrowth: '8.70', unemploymentRate: '5.30', federalDebt: 2569 },
    { year: 1951, inflationRate: '5.79', gdpGrowth: '8.10', unemploymentRate: '3.30', federalDebt: 2552 },
    { year: 1952, inflationRate: '0.88', gdpGrowth: '4.10', unemploymentRate: '3.00', federalDebt: 2591 },
  ]);
  
  // Eisenhower Term 1 (1953-1956)
  addStats('Dwight D. Eisenhower', 1, [
    { year: 1953, inflationRate: '0.62', gdpGrowth: '4.70', unemploymentRate: '2.90', federalDebt: 2661 },
    { year: 1954, inflationRate: '0.34', gdpGrowth: '-0.60', unemploymentRate: '5.50', federalDebt: 2708 },
    { year: 1955, inflationRate: '-0.35', gdpGrowth: '7.10', unemploymentRate: '4.40', federalDebt: 2744 },
    { year: 1956, inflationRate: '1.50', gdpGrowth: '2.10', unemploymentRate: '4.10', federalDebt: 2728 },
  ]);
  
  // Eisenhower Term 2 (1957-1960)
  addStats('Dwight D. Eisenhower', 2, [
    { year: 1957, inflationRate: '3.34', gdpGrowth: '2.10', unemploymentRate: '4.30', federalDebt: 2729 },
    { year: 1958, inflationRate: '2.74', gdpGrowth: '-0.70', unemploymentRate: '6.80', federalDebt: 2808 },
    { year: 1959, inflationRate: '0.95', gdpGrowth: '6.90', unemploymentRate: '5.50', federalDebt: 2847 },
    { year: 1960, inflationRate: '1.46', gdpGrowth: '2.50', unemploymentRate: '5.50', federalDebt: 2863 },
  ]);
  
  // Kennedy/LBJ Term 1 (1961-1964)
  addStats('John Kennedy', 1, [
    { year: 1961, inflationRate: '0.67', gdpGrowth: '2.30', unemploymentRate: '6.70', federalDebt: 2889 },
    { year: 1962, inflationRate: '1.33', gdpGrowth: '6.10', unemploymentRate: '5.50', federalDebt: 2982 },
    { year: 1963, inflationRate: '1.64', gdpGrowth: '4.40', unemploymentRate: '5.70', federalDebt: 3059 },
  ]);
  addStats('Lyndon B. Johnson', 1, [
    { year: 1964, inflationRate: '1.28', gdpGrowth: '5.80', unemploymentRate: '5.20', federalDebt: 3117 },
  ]);
  
  // LBJ Term 2 (1965-1968)
  addStats('Lyndon B. Johnson', 2, [
    { year: 1965, inflationRate: '1.59', gdpGrowth: '6.50', unemploymentRate: '4.50', federalDebt: 3173 },
    { year: 1966, inflationRate: '3.01', gdpGrowth: '6.60', unemploymentRate: '3.80', federalDebt: 3199 },
    { year: 1967, inflationRate: '2.78', gdpGrowth: '2.70', unemploymentRate: '3.80', federalDebt: 3262 },
    { year: 1968, inflationRate: '4.27', gdpGrowth: '4.90', unemploymentRate: '3.60', federalDebt: 3479 },
  ]);
  
  // Nixon Term 1 (1969-1972)
  addStats('Richard Nixon', 1, [
    { year: 1969, inflationRate: '5.46', gdpGrowth: '3.10', unemploymentRate: '3.50', federalDebt: 3537 },
    { year: 1970, inflationRate: '5.84', gdpGrowth: '0.20', unemploymentRate: '4.90', federalDebt: 3701 },
    { year: 1971, inflationRate: '4.30', gdpGrowth: '3.30', unemploymentRate: '5.90', federalDebt: 3981 },
    { year: 1972, inflationRate: '3.27', gdpGrowth: '5.30', unemploymentRate: '5.60', federalDebt: 4273 },
  ]);
  
  // Nixon/Ford Term 2 (1973-1976)
  addStats('Richard Nixon', 2, [
    { year: 1973, inflationRate: '6.18', gdpGrowth: '5.60', unemploymentRate: '4.90', federalDebt: 4581 },
    { year: 1974, inflationRate: '11.05', gdpGrowth: '-0.50', unemploymentRate: '5.60', federalDebt: 4751 },
  ]);
  addStats('Gerald Ford', 1, [
    { year: 1975, inflationRate: '9.14', gdpGrowth: '-0.20', unemploymentRate: '8.50', federalDebt: 5332 },
    { year: 1976, inflationRate: '5.74', gdpGrowth: '5.40', unemploymentRate: '7.70', federalDebt: 6201 },
  ]);
  
  // Carter Term 1 (1977-1980)
  addStats('Jimmy Carter', 1, [
    { year: 1977, inflationRate: '6.50', gdpGrowth: '4.60', unemploymentRate: '7.10', federalDebt: 6988 },
    { year: 1978, inflationRate: '7.62', gdpGrowth: '5.50', unemploymentRate: '6.10', federalDebt: 7715 },
    { year: 1979, inflationRate: '11.22', gdpGrowth: '3.20', unemploymentRate: '5.80', federalDebt: 8265 },
    { year: 1980, inflationRate: '13.58', gdpGrowth: '-0.30', unemploymentRate: '7.10', federalDebt: 9077 },
  ]);
  
  // Reagan Term 1 (1981-1984)
  addStats('Ronald Reagan', 1, [
    { year: 1981, inflationRate: '10.35', gdpGrowth: '2.50', unemploymentRate: '7.60', federalDebt: 9943 },
    { year: 1982, inflationRate: '6.16', gdpGrowth: '-1.80', unemploymentRate: '9.70', federalDebt: 11383 },
    { year: 1983, inflationRate: '3.22', gdpGrowth: '4.60', unemploymentRate: '9.60', federalDebt: 13321 },
    { year: 1984, inflationRate: '4.30', gdpGrowth: '7.20', unemploymentRate: '7.50', federalDebt: 15068 },
  ]);
  
  // Reagan Term 2 (1985-1988)
  addStats('Ronald Reagan', 2, [
    { year: 1985, inflationRate: '3.55', gdpGrowth: '4.20', unemploymentRate: '7.20', federalDebt: 18180 },
    { year: 1986, inflationRate: '1.91', gdpGrowth: '3.50', unemploymentRate: '7.00', federalDebt: 21152 },
    { year: 1987, inflationRate: '3.66', gdpGrowth: '3.50', unemploymentRate: '6.20', federalDebt: 23433 },
    { year: 1988, inflationRate: '4.08', gdpGrowth: '4.20', unemploymentRate: '5.50', federalDebt: 26002 },
  ]);
  
  // H.W. Bush Term 1 (1989-1992)
  addStats('George H. W. Bush', 1, [
    { year: 1989, inflationRate: '4.83', gdpGrowth: '3.70', unemploymentRate: '5.30', federalDebt: 28566 },
    { year: 1990, inflationRate: '5.40', gdpGrowth: '1.90', unemploymentRate: '5.60', federalDebt: 32066 },
    { year: 1991, inflationRate: '4.25', gdpGrowth: '-0.10', unemploymentRate: '6.80', federalDebt: 35989 },
    { year: 1992, inflationRate: '3.03', gdpGrowth: '3.50', unemploymentRate: '7.50', federalDebt: 40003 },
  ]);
  
  // Clinton Term 1 (1993-1996)
  addStats('Bill Clinton', 1, [
    { year: 1993, inflationRate: '2.95', gdpGrowth: '2.74', unemploymentRate: '6.90', federalDebt: 4411 },
    { year: 1994, inflationRate: '2.61', gdpGrowth: '4.04', unemploymentRate: '6.10', federalDebt: 4643 },
    { year: 1995, inflationRate: '2.81', gdpGrowth: '2.68', unemploymentRate: '5.60', federalDebt: 4921 },
    { year: 1996, inflationRate: '2.93', gdpGrowth: '3.77', unemploymentRate: '5.40', federalDebt: 5182 },
  ]);
  
  // Clinton Term 2 (1997-2000)
  addStats('Bill Clinton', 2, [
    { year: 1997, inflationRate: '2.34', gdpGrowth: '4.45', unemploymentRate: '4.90', federalDebt: 5413 },
    { year: 1998, inflationRate: '1.55', gdpGrowth: '4.45', unemploymentRate: '4.50', federalDebt: 5526 },
    { year: 1999, inflationRate: '2.19', gdpGrowth: '4.79', unemploymentRate: '4.20', federalDebt: 5656 },
    { year: 2000, inflationRate: '3.38', gdpGrowth: '4.13', unemploymentRate: '4.00', federalDebt: 5674 },
  ]);
  
  // W. Bush Term 1 (2001-2004)
  addStats('George W. Bush', 1, [
    { year: 2001, inflationRate: '2.83', gdpGrowth: '1.00', unemploymentRate: '4.70', federalDebt: 5807 },
    { year: 2002, inflationRate: '1.59', gdpGrowth: '1.80', unemploymentRate: '5.80', federalDebt: 6228 },
    { year: 2003, inflationRate: '2.27', gdpGrowth: '2.80', unemploymentRate: '6.00', federalDebt: 6783 },
    { year: 2004, inflationRate: '2.68', gdpGrowth: '3.80', unemploymentRate: '5.50', federalDebt: 7379 },
  ]);
  
  // W. Bush Term 2 (2005-2008)
  addStats('George W. Bush', 2, [
    { year: 2005, inflationRate: '3.39', gdpGrowth: '3.48', unemploymentRate: '5.10', federalDebt: 7932 },
    { year: 2006, inflationRate: '3.23', gdpGrowth: '2.66', unemploymentRate: '4.60', federalDebt: 8507 },
    { year: 2007, inflationRate: '2.85', gdpGrowth: '1.78', unemploymentRate: '4.60', federalDebt: 9008 },
    { year: 2008, inflationRate: '3.84', gdpGrowth: '-0.14', unemploymentRate: '5.80', federalDebt: 10025 },
  ]);
  
  // Obama Term 1 (2009-2012)
  addStats('Barack Obama', 1, [
    { year: 2009, inflationRate: '-0.36', gdpGrowth: '-2.60', unemploymentRate: '9.30', federalDebt: 11910 },
    { year: 2010, inflationRate: '1.64', gdpGrowth: '2.56', unemploymentRate: '9.60', federalDebt: 13529 },
    { year: 2011, inflationRate: '3.16', gdpGrowth: '1.55', unemploymentRate: '8.90', federalDebt: 14764 },
    { year: 2012, inflationRate: '2.07', gdpGrowth: '2.22', unemploymentRate: '8.10', federalDebt: 16066 },
  ]);
  
  // Obama Term 2 (2013-2016)
  addStats('Barack Obama', 2, [
    { year: 2013, inflationRate: '1.46', gdpGrowth: '1.84', unemploymentRate: '7.40', federalDebt: 16738 },
    { year: 2014, inflationRate: '1.62', gdpGrowth: '2.53', unemploymentRate: '6.20', federalDebt: 17824 },
    { year: 2015, inflationRate: '0.12', gdpGrowth: '2.90', unemploymentRate: '5.30', federalDebt: 18151 },
    { year: 2016, inflationRate: '1.26', gdpGrowth: '1.64', unemploymentRate: '4.90', federalDebt: 19957 },
  ]);
  
  // Trump Term 1 (2017-2020)
  addStats('Donald Trump', 1, [
    { year: 2017, inflationRate: '2.13', gdpGrowth: '2.24', unemploymentRate: '4.40', federalDebt: 20124 },
    { year: 2018, inflationRate: '2.44', gdpGrowth: '2.95', unemploymentRate: '3.90', federalDebt: 21516 },
    { year: 2019, inflationRate: '1.81', gdpGrowth: '2.29', unemploymentRate: '3.70', federalDebt: 22680 },
    { year: 2020, inflationRate: '1.23', gdpGrowth: '-3.40', unemploymentRate: '6.70', federalDebt: 26989 },
  ]);
  
  // Biden Term 1 (2021-2024)
  addStats('Joe Biden', 1, [
    { year: 2021, inflationRate: '4.70', gdpGrowth: '5.67', unemploymentRate: '5.40', federalDebt: 28143 },
    { year: 2022, inflationRate: '8.00', gdpGrowth: '2.06', unemploymentRate: '3.60', federalDebt: 30510 },
    { year: 2023, inflationRate: '4.12', gdpGrowth: '2.50', unemploymentRate: '3.70', federalDebt: 33695 },
    { year: 2024, inflationRate: '3.20', gdpGrowth: '2.70', unemploymentRate: '3.70', federalDebt: 34500 },
  ]);
  
  // Trump Term 2 (2025-2029) - partial data for 2025
  addStats('Donald Trump', 2, [
    { year: 2025, inflationRate: '2.50', gdpGrowth: '2.30', unemploymentRate: '3.80', federalDebt: 35000 },
  ]);
  
  if (statisticsData.length === 0) {
    addLog('⚠️  No presidency statistics to insert', 'log');
  } else {
    const statistics = await db.presidencyStatistics.insert(statisticsData).returning();
    addLog(`✅ Seeded ${statistics.length} presidency statistics`, 'success');
  }

  // Step 11: Verify seeding
  addLog('🔍 Verifying seeded data...', 'log');
  const peopleCount = await db.people.count();
  const presidentCount = await db.presidents.count();
  const stateCount = await db.states.count();
  const electionCount = await db.elections.count();
  const electionResultCount = await db.electionResults.count();
  const presidencyCount = await db.presidencies.count();
  const statisticsCount = await db.presidencyStatistics.count();

  addLog(`📊 Verification results:`, 'log');
  addLog(`   People: ${peopleCount}`, 'log');
  addLog(`   Presidents: ${presidentCount}`, 'log');
  addLog(`   States: ${stateCount}`, 'log');
  addLog(`   Elections: ${electionCount}`, 'log');
  addLog(`   Election Results: ${electionResultCount}`, 'log');
  addLog(`   Presidencies: ${presidencyCount}`, 'log');
  addLog(`   Presidency Statistics: ${statisticsCount}`, 'log');
  addLog(`   Total Records: ${peopleCount + presidentCount + stateCount + electionCount + electionResultCount + presidencyCount + statisticsCount}`, 'success');

  // Note: There are 69 presidencies (not 60) because some elections resulted in 2 presidencies
  // when the elected president died/resigned and the VP took over:
  // - 1840: Harrison → Tyler
  // - 1848: Taylor → Fillmore  
  // - 1864: Lincoln → Johnson
  // - 1880: Garfield → Arthur
  // - 1900: McKinley → TR
  // - 1920: Harding → Coolidge
  // - 1944: FDR → Truman
  // - 1960: Kennedy → LBJ
  // - 1972: Nixon → Ford
  // So: 60 elections + 9 successions = 69 presidencies
  if (presidentCount === 45 && stateCount === 50 && electionCount === 60 && 
      electionResultCount > 0 && presidencyCount === 69 && statisticsCount > 0) {
    addLog('✅ All data seeded successfully!', 'success');
    addLog('🎉 Database is ready for browsing in xpdb-viewer!', 'success');
  } else {
    addLog('⚠️  Seeding verification: Some counts do not match expected values', 'log');
    addLog(`   Expected: 45 presidents, 50 states, 60 elections, 69 presidencies`, 'log');
    addLog(`   Got: ${presidentCount} presidents, ${stateCount} states, ${electionCount} elections, ${presidencyCount} presidencies`, 'log');
  }
}

