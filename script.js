<div class="details">

    <div class="chart-container">

        <div class="line"></div>

        <div class="dot price"
            style="left:95%">
        </div>

        <div class="dot ema20"
            style="left:${(stock.ema20/maxValue)*100}%">
        </div>

        <div class="dot ema50"
            style="left:${(stock.ema50/maxValue)*100}%">
        </div>

        <div class="dot ema100"
            style="left:${(stock.ema100/maxValue)*100}%">
        </div>

        <div class="dot ema200"
            style="left:${(stock.ema200/maxValue)*100}%">
        </div>

    </div>

    <div class="legend">

        <div>
            <span class="legend-dot ema20"></span>
            EMA20 : ${stock.ema20}
        </div>

        <div>
            <span class="legend-dot ema50"></span>
            EMA50 : ${stock.ema50}
        </div>

        <div>
            <span class="legend-dot ema100"></span>
            EMA100 : ${stock.ema100}
        </div>

        <div>
            <span class="legend-dot ema200"></span>
            EMA200 : ${stock.ema200}
        </div>

    </div>

</div>
