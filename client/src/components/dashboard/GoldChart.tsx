import { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, IChartApi, CandlestickSeries, Time } from 'lightweight-charts';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface GoldCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface GoldChartProps {
  timeframe: string;
}

export function GoldChart({ timeframe }: GoldChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastPrice, setLastPrice] = useState<number | null>(null);
  const [priceChange, setPriceChange] = useState<number>(0);

  useEffect(() => {
    if (!containerRef.current) return;
    let isMounted = true;

    // Destroy previous chart
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    setIsLoading(true);
    setError(null);

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#78716c',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(251,191,36,0.08)' },
        horzLines: { color: 'rgba(251,191,36,0.08)' },
      },
      width: containerRef.current.clientWidth,
      height: 320,
      timeScale: {
        borderColor: '#e7e5e4',
        timeVisible: true,
        secondsVisible: false,
        fixLeftEdge: false,
        fixRightEdge: false,
      },
      rightPriceScale: {
        borderColor: '#e7e5e4',
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      crosshair: {
        mode: 1,
        vertLine: { color: '#d97706', width: 1, style: 1 },
        horzLine: { color: '#d97706', width: 1, style: 1 },
      },
    });
    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#16a34a',
      downColor: '#dc2626',
      borderVisible: false,
      wickUpColor: '#16a34a',
      wickDownColor: '#dc2626',
    });

    // Handle resize
    const observer = new ResizeObserver(() => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    observer.observe(containerRef.current);

    // Fetch candles
    fetch(`/api/gold/candles/${timeframe}`)
      .then(r => r.json())
      .then((candles: GoldCandle[]) => {
        if (!isMounted) return;
        if (!candles || candles.length === 0) {
          setError('No candle data returned.');
          setIsLoading(false);
          return;
        }
        const data = candles
          .filter(c => c.close > 0)
          .map(c => ({
            time: c.time as Time,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
          }));

        candleSeries.setData(data);
        chart.timeScale().fitContent();

        const last = data[data.length - 1];
        const prev = data[data.length - 2];
        setLastPrice(last.close);
        if (prev) setPriceChange(((last.close - prev.close) / prev.close) * 100);
        setIsLoading(false);
      })
      .catch(e => {
        if (isMounted) {
          setError(e.message || 'Failed to load chart data');
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
      observer.disconnect();
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [timeframe]);

  return (
    <div className="relative w-full">
      {/* Price overlay */}
      {lastPrice && !isLoading && (
        <div className="absolute top-3 left-4 z-10 flex items-center gap-3 pointer-events-none">
          <span className="text-lg font-bold text-amber-900 font-mono">
            ${lastPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </span>
          <span className={cn(
            'text-xs font-semibold px-1.5 py-0.5 rounded',
            priceChange >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
          )}>
            {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}%
          </span>
          <span className="text-[10px] text-amber-600 font-mono uppercase">XAU/USD</span>
        </div>
      )}

      {isLoading && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-amber-50/80">
          <Loader2 className="w-6 h-6 animate-spin text-amber-500" />
          <span className="text-xs text-amber-700">Loading XAUUSD {timeframe} chart...</span>
        </div>
      )}

      {error && !isLoading && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 bg-amber-50/80">
          <span className="text-xs text-red-500 font-medium">{error}</span>
          <span className="text-[10px] text-muted-foreground">Yahoo Finance GC=F</span>
        </div>
      )}

      <div ref={containerRef} className="w-full" style={{ height: 320 }} />
    </div>
  );
}
