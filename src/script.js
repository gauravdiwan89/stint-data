import { apiRequest } from "./apicall"; "./apicall.js"
const apiBaseURL = window.FASTF1_API_BASE_URL || 'http://127.0.0.1:5050/v1';
let driverMap = new Map();
let controller = new AbortController();
let conList = ['Mercedes', 'Ferrari', 'McLaren', 'Haas F1 Team', 'Alpine', 'Red Bull Racing', 'Racing Bulls',  'Audi', 'Williams', 'Cadillac', 'Aston Martin', 'null', null];
let curYear = 2026;
let toggleLabel = document.getElementById('toggleLabel');
let orderby = "Median";
let liveMode = false;
let liveSessionKey = null;
let livePollTimer = null;
let livePollMs = 5000;
let liveRefreshInFlight = false;
let lapSelectionState = new Map();
let telemetrySelectionState = new Map();
const exportdiv = document.getElementById('export');
const container = document.getElementById('table-container');
const chart = document.getElementById('charts');
const boxDiv = document.getElementById('boxPlot');
const barDiv = document.getElementById('barPlot');
const lineDiv = document.getElementById('linePlot'); 
const telemetryDiv = document.getElementById('telemetry-shootout');
const telemetryOptions = document.getElementById('telemetry-options');
const telemetryButton = document.getElementById('telemetry-plot');
const telemetryFastestButton = document.getElementById('telemetry-fastest');
const telemetryDeselectButton = document.getElementById('telemetry-deselect');
const telemetryStatus = document.getElementById('telemetry-status');
const telemetryPlot = document.getElementById('telemetryPlot');
const telemetryMap = document.getElementById('telemetryMap');
const loadingScreen = document.getElementById('loading-screen');
const liveStatus = document.getElementById('live-status');

function setLiveStatus(message, active = false) {
    if (!liveStatus) return;
    liveStatus.textContent = message;
    liveStatus.classList.toggle('active', active);
}

function stopLivePolling() {
    if (livePollTimer) {
        clearInterval(livePollTimer);
        livePollTimer = null;
    }
    liveRefreshInFlight = false;
}

function disableLiveMode(clearStatus = true) {
    liveMode = false;
    liveSessionKey = null;
    stopLivePolling();
    lapSelectionState.clear();
    document.getElementById('live-mode')?.classList.remove('clicked');
    if (clearStatus) setLiveStatus('');
}

function cellKeyFor(stintKey, lapNumber, rowIndex) {
    return `${stintKey}|${lapNumber || `row-${rowIndex}`}`;
}

function captureLapSelectionState() {
    document.querySelectorAll('.lap[data-cell-key]').forEach(cell => {
        lapSelectionState.set(cell.dataset.cellKey, cell.classList.contains('selected'));
    });
}

function setTelemetryStatus(message, active = false) {
    if (!telemetryStatus) return;
    telemetryStatus.textContent = message;
    telemetryStatus.classList.toggle('active', active);
}

function telemetryKey(driverNumber, lapNumber) {
    return `${driverNumber}|${lapNumber}`;
}

function speedColor(speed, minSpeed, maxSpeed) {
    if (!Number.isFinite(speed) || !Number.isFinite(minSpeed) || !Number.isFinite(maxSpeed) || maxSpeed <= minSpeed) {
        return 'rgb(225, 6, 0)';
    }
    const ratio = Math.max(0, Math.min(1, (speed - minSpeed) / (maxSpeed - minSpeed)));
    const hue = 240 - ratio * 240;
    return `hsl(${hue}, 95%, 55%)`;
}

// Interactions
function selectYear(event) {
    disableLiveMode();
    const listYears = document.querySelectorAll('.year-container li');
    listYears.forEach(item => item.classList.remove('choose'));
    
    const formlist = document.querySelector('#driver-stints-form');
    formlist.innerHTML = '';

    event.target.classList.add('choose');
    curYear = parseInt(event.target.textContent);
    event.target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    fetchMeetings(event.target.textContent);

}

function selectRace(event){
    disableLiveMode();
    const listRaces = document.querySelectorAll('.race-container li');
    listRaces.forEach(item => item.classList.remove('choose'));

    const formlist = document.querySelector('#driver-stints-form');
    formlist.innerHTML = '';

    event.target.classList.add('choose');
    event.target.scrollIntoView({ behavior: 'smooth', block: 'start' }); 
    fetchSessions(event.target.textContent);
}

function selectSession(event){
    disableLiveMode();
    const listSession = document.querySelectorAll('.session-container li');
    listSession.forEach(item => item.classList.remove('choose'));

    const formlist = document.querySelector('#driver-stints-form');
    formlist.innerHTML = '';

    event.target.classList.add('choose');
    event.target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    showDriverSearch(event.target.dataset.session_key);

}

function selectDriver(event){
    
    const listDriver = document.querySelectorAll('#driver-list li');
    event.target.classList.toggle('choose');
    // searchDriver();
}

// Create lists
function createDriverList(data){
    const driverList = document.querySelector('#driver-list');
    driverList.innerHTML = '';
    
    let array = [...data];
    if(curYear==2026){
        array.sort((a, b)=>{
            return conList.indexOf(a.team_name) - conList.indexOf(b.team_name);
        });
    }
    array.forEach(x=>{
        const driver = document.createElement('li');
        driver.dataset.driver_number = x.driver_number;
        driver.dataset.team = x.team_name;
        driver.dataset.team_color = x.team_colour;
        driver.textContent = x.broadcast_name;
        driverList.appendChild(driver);
    });
    const listDriver = document.querySelectorAll('#driver-list li');
    listDriver.forEach(item=>{
        item.addEventListener('click', selectDriver);
    });
}

function createSessionList(data){
    const sessionList = document.querySelector('#session-list');
    sessionList.innerHTML = '';
    data.forEach(x=>{
        const session = document.createElement('li');
        session.dataset.session_key = x.session_key;
        session.textContent = x.session_name;
        sessionList.appendChild(session);
    });

    const listSession = document.querySelectorAll('.session-container li');

    listSession.forEach(item=>{
        item.addEventListener('click', selectSession);
    });
    let n = listSession.length;
    if(n>0){
        listSession[n-1].classList.add('choose');
        listSession[n-1].scrollIntoView({ behavior: 'smooth', block: 'start' });
        showDriverSearch(listSession[n-1].dataset.session_key);
    }
}
  
function createRacelist(data) {
    const raceList = document.querySelector('#race-list');
    raceList.innerHTML = '';

    data.forEach(x => {
        const race = document.createElement('li');
        race.value = x.country_name;
        race.textContent = x.country_name;

        race.dataset.date_start = x.date_start;
        race.dataset.date_end = x.date_end;

        raceList.appendChild(race);
    });

    const listRaces = document.querySelectorAll('.race-container li');

    listRaces.forEach(item => {
        item.addEventListener('click', selectRace);
    });

    const now = new Date();

    let inProgressRace = null;
    let latestEndedRace = null;

    listRaces.forEach(item => {
        const start = new Date(item.dataset.date_start);
        const end = new Date(item.dataset.date_end);

        if (start <= now && now <= end) {
            inProgressRace = item;
        }

        if (end < now) {
            if (!latestEndedRace || end > new Date(latestEndedRace.dataset.date_end)) {
                latestEndedRace = item;
            }
        }
    });

    let selectedRace = inProgressRace || latestEndedRace;

    if (selectedRace) {
        selectedRace.classList.add('choose');
        selectedRace.scrollIntoView({ behavior: 'smooth', block: 'start' });
        fetchSessions(selectedRace.textContent);
    } 
    else if (listRaces.length > 0) {
        listRaces[0].classList.add('choose');
        fetchSessions(listRaces[0].textContent);
    }
}

function createYearlist(){
    const listYears = document.querySelectorAll('.year-container li');

    listYears.forEach(item => {
        item.addEventListener('click', selectYear);
    });

    listYears[0].classList.add('choose');
    listYears[0].scrollIntoView({ behavior: 'smooth', block: 'start' });
    fetchMeetings(listYears[0].textContent);
}

// API calls and gathering data
async function fetchMeetings(year){
    try {
        let data = await apiRequest(`${apiBaseURL}/meetings?year=${year}`);
        createRacelist(data);
    }
    catch (error) {
        console.log(error);
        return null;
    }
}

async function fetchSessions(country) {;
    try {
        const year = document.querySelector('.year-container li.choose').textContent;

        if (!country) {
            alert('Please select l_name country.');
            return;
        }
        let data = await apiRequest(`${apiBaseURL}/sessions?country_name=${country}&year=${year}`);
        createSessionList(data);

    } catch (error) {
        console.log(error);
        return null;
    }
    
}

async function showDriverSearch(sessionKey) {
    try {
         if (!sessionKey) {
            alert('Please select l_name session.');
            return;
        }
        let data = await apiRequest(`${apiBaseURL}/drivers?session_key=${sessionKey}`);
        createDriverList(data);

    } catch (error) {
        console.log(error);
        return null;
    }
    
}

function selectListItemByText(selector, text) {
    const items = document.querySelectorAll(selector);
    items.forEach(item => item.classList.remove('choose'));
    const match = [...items].find(item => item.textContent === String(text));
    if (match) {
        match.classList.add('choose');
        match.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function setSingleRaceAndSession(info) {
    curYear = info.year;
    selectListItemByText('.year-container li', info.year);

    const raceList = document.getElementById('race-list');
    raceList.innerHTML = '';
    const race = document.createElement('li');
    race.textContent = info.country_name;
    race.dataset.date_start = info.date_start;
    race.dataset.date_end = info.date_start;
    race.classList.add('choose');
    raceList.appendChild(race);

    const sessionList = document.getElementById('session-list');
    sessionList.innerHTML = '';
    const session = document.createElement('li');
    session.dataset.session_key = info.session_key;
    session.textContent = info.session_name;
    session.classList.add('choose');
    sessionList.appendChild(session);
}

async function waitForLiveDrivers(sessionKey, attempts = 20) {
    for (let attempt = 0; attempt < attempts; attempt++) {
        const response = await fetch(`${apiBaseURL}/drivers?session_key=${encodeURIComponent(sessionKey)}`, { cache: 'no-store' });
        if (response.ok) {
            const data = await response.json();
            if (data.length > 0) {
                createDriverList(data);
                setLiveStatus(`Live mode ready. Choose drivers, then Search. Refresh: ${livePollMs / 1000}s`, true);
                return true;
            }
        }

        const statusResponse = await fetch(`${apiBaseURL}/live/status`, { cache: 'no-store' });
        const status = await statusResponse.json().catch(() => ({}));
        if (status.auth_hint) {
            setLiveStatus(`${status.auth_hint} (${attempt + 1}/${attempts})`, true);
        } else {
            setLiveStatus(`Recording live timing... waiting for driver list (${attempt + 1}/${attempts})`, true);
        }
        await new Promise(resolve => setTimeout(resolve, 3000));
    }
    createDriverList([]);
    setLiveStatus('Live recording started, but no driver list has arrived yet. Complete F1TV authentication if the bridge terminal is asking for it.', true);
    return false;
}

async function startLiveMode() {
    try {
        disableLiveMode(false);
        setLiveStatus('Checking for a live F1 session...', true);
        const response = await fetch(`${apiBaseURL}/live/start`, { method: 'POST', cache: 'no-store' });
        const data = await response.json().catch(() => ({}));

        if (!response.ok || !data.live) {
            setLiveStatus('');
            alert(data.message || 'No live session at the moment');
            return;
        }

        liveMode = true;
        liveSessionKey = data.session_key;
        livePollMs = data.poll_interval_ms || 5000;
        document.getElementById('live-mode')?.classList.add('clicked');
        setSingleRaceAndSession(data);
        document.getElementById('driver-list').innerHTML = '';
        document.getElementById('driver-stints-form').innerHTML = '';
        container.innerHTML = '';
        chart.style.display = 'none';
        exportdiv.style.display = 'none';

        setLiveStatus(`${data.meeting_name} ${data.session_name} is live. Recording timing stream...`, true);
        if (data.auth_hint) {
            setLiveStatus(data.auth_hint, true);
        }
        await waitForLiveDrivers(liveSessionKey);
    } catch (error) {
        console.log(error);
        disableLiveMode();
        alert('Unable to start live mode. Is the FastF1 bridge running?');
    }
}

function startLiveTablePolling() {
    if (!liveMode) return;
    stopLivePolling();
    setLiveStatus(`Live table streaming every ${livePollMs / 1000}s`, true);
    livePollTimer = setInterval(async () => {
        if (liveRefreshInFlight) return;
        liveRefreshInFlight = true;
        try {
            await searchDriver({ silent: true, restartLivePoll: false });
            updateTable();
            setLiveStatus(`Live table updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`, true);
        } catch (error) {
            console.log(error);
        } finally {
            liveRefreshInFlight = false;
        }
    }, livePollMs);
}

async function gatherdata(driver_number, name, team, team_color){
    try {
        const stint = [];
        const stinttyre = [];
        const sessionKey = document.querySelector('#session-list li.choose')?.dataset.session_key;
        
        const data1 = await apiRequest(`${apiBaseURL}/laps?session_key=${sessionKey}&driver_number=${driver_number}`, { signal: controller.signal });

        const data2 = await apiRequest(`${apiBaseURL}/stints?session_key=${sessionKey}&driver_number=${driver_number}`, { signal: controller.signal });
        
        if(!data1||!data2){
            throw new Error('Missing data for driver', driver_number);
        }

        const lapsByNumber = new Map(data1.map(lap => [lap.lap_number, lap]));

        for (let i in data2) {
            stint.push([]);
        }
        for (let i in data2) {
            let start = data2[i].lap_start;
            let end = data2[i].lap_end;
            stinttyre.push(data2[i].compound);
            for (let j = start; j <= end; j++) {
                let x = lapsByNumber.get(j);
                if(x==undefined){
                    stint[i].push(['NaN', 'NaN']);
                }
                else if(x.lap_duration===null){
                    stint[i].push(['NaN', x.lap_number]);
                }
                else{
                    stint[i].push([x.lap_duration.toFixed(3), x.lap_number]);
                }         
            }
        }
        
        const sessionType = document.querySelector(".session-container .choose")?.textContent || "";
        if (sessionType.toLowerCase() == "sprint" || sessionType.toLowerCase().includes("race")) {
            let allLaps = [];
            for (let i = 0; i < stint.length; i++) {
                allLaps = allLaps.concat(stint[i]); 
            }
            stint.push(allLaps);
            stinttyre.push("ALL"); 
        }

        driverMap.set(`${name}`, {
            laptimes: [...stint],
            tyres: [...stinttyre],
            num: driver_number, 
            team_name: team,
            team_color: team_color
        });
        
    } catch (error) {
        console.log(error);
        return null;
    }
}

// Displaying data
function displayTable(stintmap) {
    let l_name = [];
    let t_name = [];
    let d_name = [];
    let k_name = [];
    let stintnum = new Map();
    let c = 0;
    let x = 0;
    for(let [driver, data] of stintmap){
        d_name.push([driver, data.laptimes.length, data.team_color]);
        if(x>0){
            c += data.laptimes.length;
        }
        else{
            c += data.laptimes.length-1;
        }
        x++;
        stintnum.set(c, 1);
        for(let i=0; i<data['laptimes'].length; i++){
            l_name.push(data.laptimes[i]);
            t_name.push(data.tyres[i]);
            k_name.push(data.stint_keys ? data.stint_keys[i] : `${driver}-${i}`);
        }
    }

    chart.style.display = "block";
    exportdiv.style.display = 'flex';
    if(l_name.length==0){
        container.innerHTML = '';
        chart.style.display = 'none';
        exportdiv.style.display = 'none';
        return;
    }
    let table = '<table border="1">';
    
    // Drivers name
    table += '<tr>';
    table += '<th class="border-bottom border-right border-left">Driver</th>';
    for (let i = 0; i < d_name.length; i++) {
        table+= `<th class="border-bottom border-right border-left" style="background-color:#${d_name[i][2]}" colspan="${d_name[i][1]}">${d_name[i][0]}</th>`
    }
    table += '</tr>';

    // Tyres name
    table += '<tr>';
    table += '<th class="border-bottom border-right border-left">Tyre</th>';
    for (let i = 0; i < l_name.length; i++) {
        if(i==0){
            if(stintnum.has(i)){
                table += `<th class="${t_name[i]} border-left border-right border-bottom">${t_name[i]}</th>`;
            }
            else{
                table += `<th class="${t_name[i]} border-left border-bottom">${t_name[i]}</th>`;
            }
            
        }
        else if(stintnum.has(i)){
            table += `<th class="${t_name[i]} border-right border-bottom">${t_name[i]}</th>`;
        }
        else{
            table += `<th class="${t_name[i]} border-bottom">${t_name[i]}</th>`;
        }
        
    }
    table += '</tr>';


    let maxLaps = Math.max(...l_name.map(s => s.length));
    for (let j = 0; j < maxLaps; j++) {

        table += '<tr>';
        if (j === 0) {
            table += '<th rowspan="' + maxLaps + '">Laps</th>';
        }
        // console.log(l_name);
        for (let i = 0; i < l_name.length; i++) {
            // console.log(l_name[i][j]);
            let lapData = l_name[i][j];
            let timeFormated = lapData!==undefined?convertTime(lapData[0]):'';
            let lapNumber = lapData!==undefined && lapData[1] !== 'NaN' ? lapData[1] : '';
            let cellKey = cellKeyFor(k_name[i], lapNumber, j);
            let selectionClass = lapSelectionState.has(cellKey) && !lapSelectionState.get(cellKey) ? 'deselected' : 'selected';
            let lapCellContent = timeFormated
                ? `<span class="lap-number">L${lapNumber}</span><span class="lap-time">${timeFormated}</span>`
                : '';
            
            if(i==0){
                if(stintnum.has(i)){
                    table += `<td class="lap ${selectionClass} border-left border-right" data-stint="${i}" data-lap="${j}" data-cell-key="${cellKey}" value="${lapData || ''}">${lapCellContent}</td>`;
                }
                else{
                    table += `<td class="lap ${selectionClass} border-left" data-stint="${i}" data-lap="${j}" data-cell-key="${cellKey}" value="${lapData || ''}">${lapCellContent}</td>`;
                }
            }
            else if(stintnum.has(i)){
                table += `<td class="lap ${selectionClass} border-right" data-stint="${i}" data-lap="${j}" data-cell-key="${cellKey}" value="${lapData || ''}">${lapCellContent}</td>`;
                
            }
            else if(i==l_name.length-1){
                table += `<td class="lap ${selectionClass} border-right" data-stint="${i}" data-lap="${j}" data-cell-key="${cellKey}" value="${lapData || ''}">${lapCellContent}</td>`;
            }
            else{
                table += `<td class="lap ${selectionClass}" data-stint="${i}" data-lap="${j}" data-cell-key="${cellKey}" value="${lapData || ''}">${lapCellContent}</td>`;
            }
        }
        table += '</tr>';
    }

    // Averages 
    table += '<tr>';
    table += '<th class="border-top">Average</th>';
    for (let i = 0; i < l_name.length; i++) {
        if(i==0){
            if(stintnum.has(i)){
                table += `<td id="avg-${i}" class="border-left border-right border-top">0.000</td>`;
            }
            else{
                table += `<td id="avg-${i}" class="border-left border-top">0.000</td>`;
            }
            
        }
        else if(stintnum.has(i)){
            table += `<td id="avg-${i}" class="border-right border-top">0.000</td>`;
        }
        else{
            table += `<td id="avg-${i}" class="border-top">0.000</td>`;
        }
        
    }
    table += '</tr>';

    table += '</table>';
    container.innerHTML = table;

    document.querySelectorAll('.lap').forEach(cell => {
        cell.addEventListener('click', () => {
            if (cell.classList.contains('selected')) {
                cell.classList.remove('selected');
                cell.classList.add('deselected');
            } else {
                cell.classList.remove('deselected');
                cell.classList.add('selected');
            }
            lapSelectionState.set(cell.dataset.cellKey, cell.classList.contains('selected'));
            updateAverages(l_name, t_name);
            updatePlot();
        });
    });

    updateAverages(l_name, t_name);
    
}

function updatePlot() {
    var x;
    var y;
    const selectiondiv = document.getElementsByClassName('selection');
    x = selectiondiv.clientWidth;
    if(x>1080){
        y = x/1.777;
    }
    let stintmap = new Map();
    const table = document.querySelector("table");
    if (!table) return;

    const rows = table.querySelectorAll("tr");
    let drivers = [];
    let stintCounts = []; 
    let tyres = [];
    let teamColors = [];
    let stintLapTimes = [];

    const driverCells = rows[0].querySelectorAll("th");
    for (let i = 1; i < driverCells.length; i++) {
        let driver = driverCells[i].textContent.trim();
        let stintCount = parseInt(driverCells[i].getAttribute("colspan")) || 1;
        let teamColor = driverCells[i].style.backgroundColor || "#000000"; 

        drivers.push(driver);
        stintCounts.push(stintCount);
        teamColors.push(teamColor);
    }

    const tyreCells = rows[1].querySelectorAll("th");
    for (let i = 1; i < tyreCells.length; i++) { 
        tyres.push(tyreCells[i].textContent.trim());
    }


    let driverIndex = 0;
    let stintIndex = 0;
    let driverStints = new Map();

    drivers.forEach((driver, i) => {
        driverStints.set(driver, { laptimes: [], tyres: [], teamColor: teamColors[i] });
        for (let j = 0; j < stintCounts[i]; j++) {
            driverStints.get(driver).laptimes.push([]);
            driverStints.get(driver).tyres.push(tyres[stintIndex]);
            stintIndex++;
        }
    });

    for (let rowIndex = 2; rowIndex < rows.length - 1; rowIndex++) { 
        const lapCells = rows[rowIndex].querySelectorAll("td");
        stintIndex = 0;
        driverIndex = 0;
        for (let i = 0; i < lapCells.length; i++) {
            let time = lapCells[i].getAttribute("value").split(",");
            let lapNumber = time[1] === "NaN" ? NaN : parseFloat(time[1]);
            let numericTime = time[0] === "NaN" ? NaN : parseFloat(time[0]);

            if (lapCells[i].classList.contains("selected")) {
                driverStints.get(drivers[driverIndex]).laptimes[stintIndex].push([numericTime, lapNumber]);
            }

            stintIndex++;
            if (stintIndex >= stintCounts[driverIndex]) {
                stintIndex = 0;
                driverIndex++;
            }
        }
    }

    driverStints.forEach((data, driver) => {
        stintmap.set(driver, {
            laptimes: data.laptimes,
            tyres: data.tyres,
            teamColor: data.teamColor
        });
    });

    let traces = [];
    let traceData = [];

    stintmap.forEach((data, driver) => {
        let tyreCount = {};

        data.laptimes.forEach((stint, index) => {
            let filteredLaps = removeOutliers(stint);
            let y = filteredLaps.map(item=>item[0]);
            let median = getMedian(y);
            let mean = getMean(y);
            let tyre = data.tyres[index].slice(0, 3).toUpperCase();
            let lastName = driver.split(" ").pop().slice(0, 3).toUpperCase();

            if (!tyreCount[tyre]) {
                tyreCount[tyre] = 1;
            } else {
                tyreCount[tyre]++;
                tyre += ` (${tyreCount[tyre]})`; 
            }
            if(mean!=-1&&median!==-1){
                traceData.push({
                    median: median,
                    mean: mean, 
                    trace: {
                        y: y,
                        type: "box",
                        boxpoints: false,
                        name: tyre==='ALL'?`${lastName}`:`${lastName}-${tyre}`,
                        marker: { color: 'white'},
                        fillcolor:data.teamColor,
                        outliercolor: data.teamColor,
                        jitter: 0.5,
                        whiskerwidth: 0.2,
                        line: { width: 2 },
                        boxpoints: 'suspectedoutliers',
                        boxmean:(orderby=='Mean')?true:false
                    }
                });
            }
            
        });
    });
    
    if(orderby=='Mean'){
        traceData.sort((a, b) => a.mean - b.mean);
    }
    else{
        traceData.sort((a, b) => a.median - b.median);
    }
    
    traces = traceData.map(item => item.trace);
    const now = new Date();
    const timestamp = now.toISOString().replace(/[-T:.Z]/g, "").slice(3, 14);
    let config = {
        responsive: true,
        toImageButtonOptions: {
          format: 'png', // one of png, svg, jpeg, webp
          filename: `plot_${timestamp}`,
          height: 800,
          width: 1080,
          scale:1
        }
    };

    let layout1 = {
        title :{
            text: `Race Pace Sorted by ${orderby}`
        },
        xaxis:{
            tickangle: -90,
            showline: true,        // show the axis line
            linecolor: 'white',      // axis line color
            linewidth: 2,          // thickness of axis line
            tickcolor:  'rgb(50, 50, 50)',  
            
        },
        yaxis: { 
            title:{
                text : "LAP TIME"
            },
            // autorange: true, 
            showgrid: true,
            gridcolor: 'rgb(50, 50, 50)',
            gridwidth: 1,
            showline: true,        // show the axis line
            linecolor: 'white',      // axis line color
            linewidth: 2,          // thickness of axis line
            tickcolor:  'rgb(50, 50, 50)',  
            // scaleanchor: "x",
            
        },
        margin: {
            l: 50,
            r: 30,
            // b: 65,
            // t: 65
        },
        paper_bgcolor: "rgb(0,0,0)",
        plot_bgcolor: "rgb(0,0,0)",
        showlegend: false,
        font: {
            color: '#ffffff',
            size: 16 
        },
        modebar: {
            remove: 'lasso2dp',
            orientation: 'v'
        },
        height: y,
        width: x,
    };

    // bar graph
    let first = (orderby=="Mean")?traceData[0].mean:traceData[0].median;
    let bar = [
        {
            y: (orderby=="Mean")?traceData.map(item=>item.mean/first*100-100):traceData.map(item=>item.median/first*100-100),

            x: traceData.map(item=>item.trace.name),
            text: (orderby=="Mean")?traceData.map(item=>(item.mean/first*100-100).toFixed(3)+"%"):traceData.map(item=>(item.median/first*100-100).toFixed(3)+"%"),
            marker:{
                color: traceData.map(item=>item.trace.fillcolor),
            },
            type: 'bar',
            textposition: "outside",
            textfont : {
                size: 16,
                weight: 700
                
            },
            textangle: "-90",
            cliponaxis: false
        }
    ];

    let layout2 = {
        title :{
            text: `Deficit to the leader Sorted by ${orderby}`
        },
        xaxis:{
            tickangle: -90,
            automargin: true,
            showline: true,        // show the axis line
            linecolor: 'white',      // axis line color
            linewidth: 2,          // thickness of axis line
            tickcolor:  'rgb(50, 50, 50)',  
        },
        yaxis: { 
            title:{
                text : "SLOWER ===>"
            },
            autorange: true, 
            showgrid: true,
            gridcolor: 'rgb(50, 50, 50)',
            gridwidth: 1,
            automargin: true,
            showline: true,        // show the axis line
            linecolor: 'white',      // axis line color
            linewidth: 2,          // thickness of axis line
            tickcolor:  'rgb(50, 50, 50)',  
         },
        margin: {
            l: 50,
            r: 30,
            // b: 65,
            // t: 65
        },
        paper_bgcolor: "rgb(0,0,0)",
        plot_bgcolor: "rgb(0,0,0)",
        showlegend: false,
        font: {
            color: '#ffffff',
            size: 16 
        },
        modebar: {
            remove: 'lasso',
            orientation: 'v'
        },
        height: y,
        width: x,
        
    };

    // Line chart
    let layout3 = {
        title :{
            text: `Race Progression`
        },
        xaxis:{
            // tickangle: 90,
            dtick: 5,
            showline: true,        // show the axis line
            linecolor: 'white',      // axis line color
            linewidth: 2,          // thickness of axis line
            tickcolor:  'rgb(50, 50, 50)',  
        },
        yaxis: { 
            title:{
                text : "LAP TIME"
            },
            autorange: true, 
            showgrid: true,
            gridcolor: 'rgb(50, 50, 50)',
            gridwidth: 1,
            showline: true,        // show the axis line
            linecolor: 'white',      // axis line color
            linewidth: 2,          // thickness of axis line
            tickcolor:  'rgb(50, 50, 50)',  
         },
        margin: {
            l: 50,
            r: 30,
            // b: 65,
            // t: 65
        },
        paper_bgcolor: "rgb(0,0,0)",
        plot_bgcolor: "rgb(0,0,0)",
        font: {
            color: '#ffffff',
            size: 16 
        },
        modebar: {
            remove: 'lasso2dp',
            orientation: 'v'
        },
        legend: {"orientation": "h"},
        height: y,
        width: x,
    };

    let linetraces = [];
    let colorCount = {};
    stintmap.forEach((data, driver) => {
        let color = data.teamColor;
        if (!colorCount[color]) {
            colorCount[color] = 1;
        } else {
            colorCount[color]++; 
        }
        data.laptimes.forEach((stint, index) => {
            let filteredLaps = removeOutliers(stint);
            let y = filteredLaps.map(item=>item[0]);
            let x = filteredLaps.map(item=>item[1]);
            let lastName = driver.split(" ").pop().slice(0, 3).toUpperCase();

            linetraces.push ({
                y: y,
                x: x,
                type: "scatter",
                name: `${lastName}`,
                marker: { color: data.teamColor, size: 2 },
                line: { 
                    dash: (colorCount[data.teamColor]===1)?'solid':'dot',
                    width: 2 
                },
            });
        });
    });


    Plotly.newPlot("boxPlot", traces, layout1, config);
    Plotly.newPlot("barPlot", bar, layout2, config);
    Plotly.newPlot("linePlot", linetraces, layout3, config);

    function debounce(func, delay) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), delay);
        };
    }
    
    const resizePlot = debounce(function() {
        let x = boxDiv.clientWidth; 
        let height = x < 1080 ? x : x / 1.777;
    
        [boxDiv, barDiv, lineDiv].forEach(div => {
            Plotly.relayout(div, { width: x, height: height });
        });
    }, 200);
    
    window.addEventListener("resize", resizePlot);
    
    window.onload = resizePlot;
}

function convertTime(sss_mmm) {
    if(!sss_mmm){
        return '';
    }
    let [seconds, milliseconds] = sss_mmm.split('.');

    seconds = parseInt(seconds, 10);
    
    let minutes = Math.floor(seconds / 60);
    let remainingSeconds = seconds % 60;

    if(milliseconds==undefined|| minutes===NaN|| remainingSeconds===NaN){
        return 'NaN';
    }
    
    let formattedTime = `${String(minutes).padStart(1, '0')}:${String(remainingSeconds).padStart(2, '0')}.${milliseconds}`;
    
    return formattedTime;
}

function updateAverages(l_name, t_name) {
    for (let i = 0; i < l_name.length; i++) {
        let sum = 0;
        let count = 0;
        document.querySelectorAll(`.lap[data-stint="${i}"]`).forEach(cell => {
            if (cell.classList.contains('selected')) {
                const lapTime = parseFloat(cell.getAttribute('value'));
                if (!isNaN(lapTime)) {
                    sum += lapTime;
                    count++;
                }
            }
        });
        const average = count === 0 ? 0 : (sum / count).toFixed(3);
        let timeFormated = convertTime(average);
        document.getElementById(`avg-${i}`).textContent = timeFormated;
    }
}

function exportToExcel() {
    try {
        const table = document.querySelector('table');
        const wb = XLSX.utils.table_to_book(table, {sheet: "Sheet1"});
        XLSX.writeFile(wb, 'stint_data.xlsx');
    } catch (error) {
        console.log(error);
    }
    
}

async function searchDriver(options = {}){
    const silent = options.silent || false;
    const restartLivePoll = options.restartLivePoll !== false;
    try{
        controller.abort(); 
        controller = new AbortController();
        if (!silent) loadingScreen.style.display = 'flex';
        const container = document.getElementById('table-container');
        if (!silent) container.innerHTML = '';
        const chart = document.getElementById('charts');
        if (!silent) chart.style.display = "none";
        const exportdiv = document.getElementById('export');
        if (!silent) exportdiv.style.display = 'none';
        driverMap.clear();
        const selectedDriver = document.querySelectorAll('#driver-list .choose');
        if(selectedDriver.length!=0){
            document.getElementById('selectall').classList.add('clicked');
            document.getElementById('selectall').textContent = 'UNSELECT ALL';
        }
        if(selectedDriver.length==0){
            document.getElementById('selectall').classList.remove('clicked');
            document.getElementById('selectall').textContent = 'SELECT ALL';
        }
        for (let i = 0; i < selectedDriver.length; i++) {
            const element = selectedDriver[i];
            await gatherdata(element.dataset.driver_number, element.textContent, element.dataset.team, element.dataset.team_color);
        }
        generateStintSelection();
        if (liveMode) {
            updateTable();
            if (restartLivePoll) startLiveTablePolling();
        }
        }
    catch(error){
        console.log(error);
        loadingScreen.style.display = 'none';
    }
    
}

function generateStintSelection() {
    const formContainer = document.getElementById('driver-stints-form');
    const previousChecks = new Map(
        [...formContainer.querySelectorAll('input[type="checkbox"]')].map(input => [input.id, input.checked])
    );
    formContainer.innerHTML = '';
    loadingScreen.style.display = 'none';
    const updatebutton = document.getElementById('update');
    updatebutton.style.display = 'block';
    let array = [...driverMap];
    if(curYear==2026){
        array.sort((a, b)=>{
            return conList.indexOf(a[1].team_name) - conList.indexOf(b[1].team_name);
        });
    }
    else{
        array.sort((a, b)=>{
            if (a[1].team_name < b[1].team_name) return -1;
            if (a[1].team_name > b[1].team_name) return 1;
            return 0;
        });
    }
    
    driverMap = new Map(array);
    if(array.length==0){
        updatebutton.style.display = 'none';
    }
    else{
        for (let [driver, data] of driverMap) {
            const driverDiv = document.createElement('div');
            driverDiv.className = 'driver-div';
            driverDiv.dataset.driverno = data.num;
    
            const driverLabel = document.createElement('div');
            driverLabel.textContent = `${driver}`;
            driverLabel.className = 'drivername'
    
            const del = document.createElement('button');
            del.textContent = 'REMOVE';
            del.className = 'del-button'
            del.dataset.driver_number = data.num;
    
            driverDiv.appendChild(del);
            driverDiv.appendChild(driverLabel);
            const sessionType = document.querySelector(".session-container .choose")?.textContent || "";
            
            for (let i = 0; i < data.laptimes.length; i++) {
                const holder = document.createElement('div');
                holder.className = 'holder';
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.id = `stint-${driver}-${i}`;
                checkbox.value = i;
                
                const label = document.createElement('label');
                const stintLapCount = data.laptimes[i].length;
                label.htmlFor = `stint-${driver}-${i}`;
                const tyreType = data.tyres[i];
                label.textContent = ` ${tyreType} (${stintLapCount} laps)`;
    
                if (previousChecks.has(checkbox.id)) {
                    checkbox.checked = previousChecks.get(checkbox.id);
                }
                else if (sessionType.toLowerCase() == "sprint" || sessionType.toLowerCase().includes("race") ) {
                    if(label.textContent.toLocaleLowerCase().includes("all")){
                        checkbox.checked = true; 
                    }
                    else{
                        checkbox.checked = false; 
                    }
                }
                else{
                    checkbox.checked = true; 
                }
                
                holder.appendChild(checkbox);
                holder.appendChild(label);
                driverDiv.appendChild(holder);
            }
    
            del.addEventListener('click', (event)=>{
                const ul = document.getElementById('driver-list');
                const list = ul.getElementsByTagName('li');
                const driverNumber = event.target.dataset.driver_number;
                for(let li of list){
                    if(li.dataset.driver_number===driverNumber){
                        li.classList.remove('choose');
                        removeCard(driverNumber);
                    }
                }
            });
            formContainer.appendChild(driverDiv);
        }
    }

    
}

function removeCard(dec){    
    const card = document.querySelector(`.driver-div[data-driverno="${dec}"]`);
    card.remove();
    updateTable();
}

function updateTelemetryShootoutOptions() {
    if (!telemetryDiv || !telemetryOptions) return;
    telemetryOptions.innerHTML = '';

    const options = [];
    for (let [driver, data] of driverMap) {
        const seen = new Set();
        data.laptimes.forEach(stint => {
            stint.forEach(lap => {
                const lapTime = lap?.[0];
                const lapNumber = lap?.[1];
                if (!lapNumber || lapNumber === 'NaN' || lapTime === 'NaN' || seen.has(lapNumber)) return;
                seen.add(lapNumber);
                options.push({
                    driver,
                    driverNumber: data.num,
                    teamColor: data.team_color,
                    lapNumber,
                    lapTime
                });
            });
        });
    }

    telemetryDiv.style.display = options.length ? 'block' : 'none';
    if (!options.length) {
        telemetrySelectionState.clear();
        if (telemetryPlot) Plotly.purge(telemetryPlot);
        setTelemetryStatus('');
        return;
    }

    options.sort((a, b) => {
        if (a.driver === b.driver) return Number(a.lapNumber) - Number(b.lapNumber);
        return a.driver.localeCompare(b.driver);
    });

    options.forEach(option => {
        const key = telemetryKey(option.driverNumber, option.lapNumber);
        const item = document.createElement('label');
        item.className = 'telemetry-option';
        item.style.borderColor = `#${option.teamColor}`;

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.dataset.driver_number = option.driverNumber;
        checkbox.dataset.driver = option.driver;
        checkbox.dataset.lap_number = option.lapNumber;
        checkbox.dataset.team_color = option.teamColor;
        checkbox.checked = telemetrySelectionState.get(key) || false;
        checkbox.addEventListener('change', () => {
            telemetrySelectionState.set(key, checkbox.checked);
        });

        const text = document.createElement('span');
        text.textContent = `${option.driver} L${option.lapNumber} ${convertTime(option.lapTime)}`;

        item.appendChild(checkbox);
        item.appendChild(text);
        telemetryOptions.appendChild(item);
    });
}

async function plotTelemetryShootout() {
    if (!telemetryOptions || !telemetryPlot) return;
    const checked = [...telemetryOptions.querySelectorAll('input[type="checkbox"]:checked')];
    if (!checked.length) {
        setTelemetryStatus('Choose at least one lap to plot.', true);
        return;
    }

    const sessionKey = document.querySelector('#session-list li.choose')?.dataset.session_key;
    if (!sessionKey) {
        setTelemetryStatus('Choose a session first.', true);
        return;
    }

    telemetryButton.disabled = true;
    setTelemetryStatus('Loading telemetry traces...', true);

    try {
        const traces = [];
        const loadedTelemetry = [];
        let speedMin = Infinity;
        let speedMax = -Infinity;
        for (const checkbox of checked) {
            const params = new URLSearchParams({
                session_key: sessionKey,
                driver_number: checkbox.dataset.driver_number,
                lap_number: checkbox.dataset.lap_number
            });
            const data = await apiRequest(`${apiBaseURL}/telemetry?${params.toString()}`);
            if (!data || !data.points || !data.points.length) continue;

            data.points.forEach(point => {
                speedMin = Math.min(speedMin, point.speed);
                speedMax = Math.max(speedMax, point.speed);
            });
            loadedTelemetry.push({
                driver: checkbox.dataset.driver,
                lapNumber: data.lap_number,
                teamColor: checkbox.dataset.team_color,
                points: data.points
            });

            traces.push({
                x: data.points.map(point => point.distance),
                y: data.points.map(point => point.speed),
                type: 'scatter',
                mode: 'lines',
                name: `${checkbox.dataset.driver} L${data.lap_number}`,
                line: {
                    color: `#${checkbox.dataset.team_color}`,
                    width: 2
                }
            });
        }

        if (!traces.length) {
            setTelemetryStatus('No telemetry traces available for the selected laps.', true);
            Plotly.purge(telemetryPlot);
            if (telemetryMap) telemetryMap.innerHTML = '';
            return;
        }

        const cornerParams = new URLSearchParams({ session_key: sessionKey });
        const corners = await apiRequest(`${apiBaseURL}/corners?${cornerParams.toString()}`) || [];
        const cornerY = Number.isFinite(speedMin) ? speedMin - 22 : 0;
        const shapes = corners.map(corner => ({
            type: 'line',
            x0: corner.distance,
            x1: corner.distance,
            y0: Number.isFinite(speedMin) ? speedMin - 12 : 0,
            y1: Number.isFinite(speedMax) ? speedMax + 12 : 1,
            xref: 'x',
            yref: 'y',
            line: {
                color: '#8b8b95',
                width: 1,
                dash: 'dot'
            }
        }));
        const annotations = corners.map(corner => ({
            x: corner.distance,
            y: cornerY,
            xref: 'x',
            yref: 'y',
            text: `${corner.number}${corner.letter || ''}`,
            showarrow: false,
            font: { color: '#d8d8df', size: 10 },
            yanchor: 'top'
        }));

        const layout = {
            title: { text: 'Lap Shootout Speed Trace', font: { color: 'white' } },
            xaxis: { title: 'Distance (m)', color: 'white', gridcolor: '#30303a' },
            yaxis: {
                title: 'Speed (km/h)',
                color: 'white',
                gridcolor: '#30303a',
                range: Number.isFinite(speedMin) && Number.isFinite(speedMax) ? [speedMin - 36, speedMax + 18] : undefined
            },
            paper_bgcolor: '#15151e',
            plot_bgcolor: '#15151e',
            legend: { font: { color: 'white' } },
            margin: { t: 48, r: 24, b: 64, l: 64 },
            shapes,
            annotations
        };

        Plotly.newPlot(telemetryPlot, traces, layout, { responsive: true });
        plotTelemetryTrackMap(loadedTelemetry, speedMin, speedMax);
        setTelemetryStatus(`${traces.length} telemetry trace${traces.length === 1 ? '' : 's'} plotted${corners.length ? ` with ${corners.length} corner markers` : ''}.`, true);
    } finally {
        telemetryButton.disabled = false;
    }
}

function plotTelemetryTrackMap(laps, speedMin, speedMax) {
    if (!telemetryMap) return;
    telemetryMap.innerHTML = '';

    let renderedMaps = 0;
    laps.forEach((lap, index) => {
        const points = lap.points.filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
        if (points.length < 2) return;

        const card = document.createElement('div');
        card.className = 'telemetry-map-card';

        const plot = document.createElement('div');
        plot.className = 'telemetry-map-plot';
        plot.id = `telemetry-map-${index}`;
        card.appendChild(plot);
        telemetryMap.appendChild(card);

        const mapTraces = [];
        for (let i = 1; i < points.length; i++) {
            const speed = (points[i - 1].speed + points[i].speed) / 2;
            mapTraces.push({
                x: [points[i - 1].x, points[i].x],
                y: [points[i - 1].y, points[i].y],
                type: 'scatter',
                mode: 'lines',
                hoverinfo: 'text',
                text: `${lap.driver} L${lap.lapNumber}<br>${speed.toFixed(0)} km/h`,
                line: {
                    color: speedColor(speed, speedMin, speedMax),
                    width: 4
                },
                showlegend: false
            });
        }

        mapTraces.push({
            x: [points[0].x],
            y: [points[0].y],
            type: 'scatter',
            mode: 'markers',
            name: `${lap.driver} L${lap.lapNumber}`,
            marker: {
                color: `#${lap.teamColor}`,
                size: 8,
                symbol: 'circle'
            }
        });

        const layout = {
            title: { text: `${lap.driver} L${lap.lapNumber}`, font: { color: 'white', size: 13 } },
            xaxis: { visible: false, scaleanchor: 'y', scaleratio: 1 },
            yaxis: { visible: false },
            paper_bgcolor: '#15151e',
            plot_bgcolor: '#15151e',
            legend: { font: { color: 'white' }, orientation: 'h' },
            margin: { t: 34, r: 8, b: 8, l: 8 },
            showlegend: false
        };

        Plotly.newPlot(plot, mapTraces, layout, { responsive: true, displayModeBar: false });
        renderedMaps++;
    });

    if (!renderedMaps) {
        telemetryMap.innerHTML = '';
    }
}

function deselectTelemetryShootout() {
    if (!telemetryOptions) return;
    telemetryOptions.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
        checkbox.checked = false;
        telemetrySelectionState.set(telemetryKey(checkbox.dataset.driver_number, checkbox.dataset.lap_number), false);
    });
    if (telemetryPlot) Plotly.purge(telemetryPlot);
    if (telemetryMap) telemetryMap.innerHTML = '';
    setTelemetryStatus('Shootout lap selection cleared.', true);
}

function pickFastestTelemetryLaps() {
    const fastestByDriver = new Map();

    for (let [_driver, data] of driverMap) {
        data.laptimes.forEach(stint => {
            stint.forEach(lap => {
                const lapTime = parseFloat(lap?.[0]);
                const lapNumber = lap?.[1];
                if (!lapNumber || lapNumber === 'NaN' || isNaN(lapTime)) return;

                const current = fastestByDriver.get(data.num);
                if (!current || lapTime < current.lapTime) {
                    fastestByDriver.set(data.num, { lapNumber, lapTime });
                }
            });
        });
    }

    telemetrySelectionState.clear();
    telemetryOptions.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
        const fastest = fastestByDriver.get(checkbox.dataset.driver_number);
        const checked = Boolean(fastest && String(fastest.lapNumber) === String(checkbox.dataset.lap_number));
        checkbox.checked = checked;
        telemetrySelectionState.set(telemetryKey(checkbox.dataset.driver_number, checkbox.dataset.lap_number), checked);
    });

    setTelemetryStatus(`${fastestByDriver.size} fastest lap${fastestByDriver.size === 1 ? '' : 's'} selected.`, true);
}

function updateTable(){
    let stintmap = new Map();
    for (let [driver, data] of driverMap) {
        let laps = [];
        let tyres = [];
        let stintKeys = [];
        for (let i = 0; i < data.laptimes.length; i++) {
            const checkbox = document.getElementById(`stint-${driver}-${i}`);
            if (checkbox && checkbox.checked) {
                laps.push(data.laptimes[i]);
                tyres.push(data.tyres[i]);
                stintKeys.push(`${data.num || driver}-${i}`);
            }
        }
        if(laps.length!=0){
            stintmap.set(driver, {
                laptimes:[...laps],
                tyres: [...tyres],
                stint_keys: [...stintKeys],
                team_name: data.team_name,
                team_color: data.team_color
            });
        }
        else{
            stintmap.delete(driver);
        }
        
    }
    captureLapSelectionState();
    displayTable(stintmap);
    updatePlot();
    updateTelemetryShootoutOptions();
}

function getMedian(arr) {
    if(arr.length<1){
        return -1;
    }
    let sorted = [...arr].filter(v => v !== 'NaN' && !isNaN(v)).map(v => parseFloat(v)).sort((a, b) => a - b);
    let mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function getMean(arr){
    if(arr.length<1){
        return -1;
    }
    let sorted = [...arr].filter(v => v !== 'NaN' && !isNaN(v)).map(v => parseFloat(v)).sort((a, b) => a - b);
    let sum = 0;
    for(let i=0; i<sorted.length; i++){
        sum+=sorted[i];
    }
    return sum/sorted.length;
}

function removeOutliers(data) {
    let cleanedData = data.filter(val => val[0] !== 'NaN' && !isNaN(val[0])).map(val => [parseFloat(val[0]), parseInt(val[1])]); 
    return cleanedData;
}

// Buttons
document.getElementById('screenshot-btn').addEventListener('click', function() {
    const tableContainer = document.getElementById('table-container');
    
    html2canvas(tableContainer).then(function(canvas) {    
        let link = document.createElement('a');
        link.href = canvas.toDataURL();  
        link.download = 'screenshot.png';  
        link.click();  
    });
});

document.getElementById('selectall').addEventListener('click', function(){
    if(this.classList.contains('clicked')){
        this.classList.remove('clicked');
        const listDriver = document.querySelectorAll('#driver-list li');
        listDriver.forEach(item=> item.classList.remove('choose'));
        this.textContent = 'SELECT ALL';
        searchDriver();
    }
    else{
        loadingScreen.style.display = 'flex';
        this.classList.add('clicked');
        const listDriver = document.querySelectorAll('#driver-list li');
        listDriver.forEach(item=> item.classList.add('choose'));
        this.textContent = 'UNSELECT ALL';
        searchDriver();
    }
});

let isMedianSort = true; // Default OFF state

document.getElementById('toggleSwitch').addEventListener("change", function(){
    isMedianSort = !isMedianSort;
    toggleLabel.textContent = isMedianSort ? "Median" : "Mean";
    orderby = isMedianSort ? "Median" : "Mean";
    updatePlot();
})

document.getElementById("searchButton").addEventListener("click", searchDriver);
document.getElementById("live-mode").addEventListener("click", startLiveMode);
document.getElementById('update').addEventListener('click', updateTable);
document.getElementById('export-but').addEventListener('click', exportToExcel);
document.getElementById('telemetry-plot').addEventListener('click', plotTelemetryShootout);
document.getElementById('telemetry-fastest').addEventListener('click', pickFastestTelemetryLaps);
document.getElementById('telemetry-deselect').addEventListener('click', deselectTelemetryShootout);


createYearlist();
