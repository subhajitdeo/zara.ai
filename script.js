<!-- index.html -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Technical Lens</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>

<div class="container">

  <header class="topbar">
    <div>
      <h1>TECHNICAL LENS</h1>
      <p>EMA Structure Scanner</p>
    </div>

    <div class="top-controls">
      <select id="sortSelect">
        <option value="score">Trend Strength</option>
        <option value="change">Change % High → Low</option>
        <option value="symbol">Name A-Z</option>
      </select>
    </div>
  </header>

  <div class="update-bar" id="updateBar">
    ● Last update: Loading...
  </div>

  <div id="stockContainer"></div>

</div>

<script src="script.js"></script>
</body>
</html>
