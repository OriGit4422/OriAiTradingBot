import { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, IChartApi, CandlestickSeries, LineSeries, Time } from 'lightweight-charts';
import { fetchKlines, subscribeToKline } from '@/lib/binance';
import { analyzeMarket } from '@/lib/strategies';
import { Loader2, Zap, Palette } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TradingChartProps {
  symbol: string;
  timeframe: string;
}

const LAYER_SERIES_KEYS = ['SMC', 'ICT', 'Quantum'] as const;
type LayerSeriesKey = typeof LAYER_SERIES_KEYS[number];

const DEFAULT_COLORS: Record<LayerSeriesKey, string> = {
  SMC: '#0ea5e9',
  ICT: '#f59e0b',
  Quantum: '#8b5cf6',
};

export function TradingChart({ symbol, timeframe }: TradingChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const colorInputRefs = useRef<Partial<Record<LayerSeriesKey, HTMLInputElement | null>>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<any>(null);
  const [showColorPicker, setShowColorPicker] = useState<string | null>(null);

  const [visibleLayers, setVisibleLayers] = useState({
    SMC: true,
    ICT: false,
    DDMC: false,
    Liquidity: true,
    Quantum: true
  });

  const [layerColors, setLayerColors] = useState<Record<LayerSeriesKey, string>>({ ...DEFAULT_COLORS });

  const toggleLayer = (layer: keyof typeof visibleLayers) => {
    setVisibleLayers(prev => ({ ...prev, [layer]: !prev[layer] }));
  };

  const handleColorChange = (layer: LayerSeriesKey, color: string) => {
    setLayerColors(prev => ({ ...prev, [layer]: color }));
  };

  useEffect(() => {
    if (!chartContainerRef.current) return;

    let isMounted = true;
    setIsLoading(true);

    const chart = createChart(chartContainerRef.current, {
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#94a3b8' },
      grid: { vertLines: { color: 'rgba(30, 41, 59, 0.05)' }, horzLines: { color: 'rgba(30, 41, 59, 0.05)' } },
      width: chartContainerRef.current.clientWidth,
      height: 400,
      timeScale: { borderColor: '#1e293b', timeVisible: true },
      rightPriceScale: { borderColor: '#1e293b' },
    });

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981', downColor: '#ef4444', borderVisible: false, wickUpColor: '#10b981', wickDownColor: '#ef4444',
    });

    const qlSeries = chart.addSeries(LineSeries, { color: layerColors.Quantum, lineWidth: 1, lineStyle: 2, title: 'QUANTUM LIQ' });
    const snrSeries = chart.addSeries(LineSeries, { color: layerColors.SMC, lineWidth: 1, lineStyle: 1, title: 'SNR' });
    const ictSeries = chart.addSeries(LineSeries, { color: layerColors.ICT, lineWidth: 1, lineStyle: 3, title: 'ICT FVG' });

    let unsubscribe: (() => void) | undefined;

    const loadData = async () => {
      try {
        const data = await fetchKlines(symbol, timeframe);
        if (!isMounted) return;

        const chartData = data.map(d => ({ ...d, time: d.time as Time }));
        candlestickSeries.setData(chartData);

        const result = analyzeMarket(data);
        setAnalysis(result);

        qlSeries.applyOptions({ visible: visibleLayers.Quantum });
        snrSeries.applyOptions({ visible: visibleLayers.SMC });
        ictSeries.applyOptions({ visible: visibleLayers.ICT });

        if (result.quantumZones.length > 0) qlSeries.setData(chartData.map(d => ({ time: d.time, value: result.quantumZones[0].price })));
        if (result.orderBlocks.length > 0) snrSeries.setData(chartData.map(d => ({ time: d.time, value: result.orderBlocks[0].price })));
        if (result.fvg.length > 0) ictSeries.setData(chartData.map(d => ({ time: d.time, value: result.fvg[0].type === 'BULLISH' ? result.fvg[0].top : result.fvg[0].bottom })));

        (chart as any)._customSeries = { qlSeries, snrSeries, ictSeries };

        setIsLoading(false);
        unsubscribe = subscribeToKline(symbol, timeframe, (kline) => {
          if (!isMounted) return;
          candlestickSeries.update({ ...kline, time: kline.time as Time });
        });
      } catch (err) {
        if (!isMounted) return;
        setError('Connection failed');
        setIsLoading(false);
      }
    };

    loadData();
    chartRef.current = chart;
    const handleResize = () => chartContainerRef.current && chart.applyOptions({ width: chartContainerRef.current.clientWidth });
    window.addEventListener('resize', handleResize);

    return () => {
      isMounted = false;
      window.removeEventListener('resize', handleResize);
      if (unsubscribe) unsubscribe();
      chart.remove();
    };
  }, [symbol, timeframe]);

  // Apply visibility changes without reloading data
  useEffect(() => {
    if (chartRef.current) {
      const { qlSeries, snrSeries, ictSeries } = (chartRef.current as any)._customSeries || {};
      if (qlSeries) qlSeries.applyOptions({ visible: visibleLayers.Quantum });
      if (snrSeries) snrSeries.applyOptions({ visible: visibleLayers.SMC });
      if (ictSeries) ictSeries.applyOptions({ visible: visibleLayers.ICT });
    }
  }, [visibleLayers]);

  // Apply color changes to series
  useEffect(() => {
    if (chartRef.current) {
      const { qlSeries, snrSeries, ictSeries } = (chartRef.current as any)._customSeries || {};
      if (qlSeries) qlSeries.applyOptions({ color: layerColors.Quantum });
      if (snrSeries) snrSeries.applyOptions({ color: layerColors.SMC });
      if (ictSeries) ictSeries.applyOptions({ color: layerColors.ICT });
    }
  }, [layerColors]);

  const isColorableLayer = (layer: string): layer is LayerSeriesKey =>
    LAYER_SERIES_KEYS.includes(layer as LayerSeriesKey);

  return (
    <div className="w-full h-[400px] relative">
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center z-20 bg-background/50 backdrop-blur-sm">
          <Loader2 className="animate-spin text-primary" />
        </div>
      )}

      {/* Strategy Controls Overlay */}
      <div className="absolute top-4 left-4 z-10 flex gap-2 pointer-events-auto flex-wrap">
        {Object.keys(visibleLayers).map((strat) => {
          const active = visibleLayers[strat as keyof typeof visibleLayers];
          const colorable = isColorableLayer(strat);
          const color = colorable ? layerColors[strat as LayerSeriesKey] : null;

          return (
            <div key={strat} className="relative flex items-center">
              <button
                onClick={() => toggleLayer(strat as keyof typeof visibleLayers)}
                className={cn(
                  "px-3 py-1 text-xs rounded-l border transition-all font-medium backdrop-blur-md",
                  colorable ? "rounded-r-none border-r-0" : "rounded",
                  active
                    ? "bg-primary/20 border-primary text-primary shadow-[0_0_10px_rgba(14,165,233,0.2)]"
                    : "bg-background/40 border-border text-muted-foreground hover:bg-background/60"
                )}
              >
                {strat}
              </button>

              {colorable && (
                <>
                  <button
                    onClick={() => {
                      setShowColorPicker(showColorPicker === strat ? null : strat);
                      colorInputRefs.current[strat as LayerSeriesKey]?.click();
                    }}
                    className={cn(
                      "h-full px-1.5 rounded-r border border-l-0 flex items-center gap-1 transition-all backdrop-blur-md",
                      active
                        ? "bg-primary/20 border-primary"
                        : "bg-background/40 border-border hover:bg-background/60"
                    )}
                    title={`Change ${strat} color`}
                  >
                    <span
                      className="w-3 h-3 rounded-full border border-white/30 shadow-sm flex-shrink-0"
                      style={{ backgroundColor: color! }}
                    />
                  </button>
                  <input
                    ref={(el) => { colorInputRefs.current[strat as LayerSeriesKey] = el; }}
                    type="color"
                    value={color!}
                    onChange={(e) => handleColorChange(strat as LayerSeriesKey, e.target.value)}
                    className="absolute opacity-0 w-0 h-0 pointer-events-none"
                    tabIndex={-1}
                  />
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="absolute top-4 right-4 z-10 flex flex-col gap-1 pointer-events-none">
        {analysis?.marketPhase && (
          <div className="bg-primary/20 text-primary border border-primary/30 px-2 py-0.5 rounded text-[10px] font-mono flex items-center gap-1">
            <Zap className="w-3 h-3" /> PHASE: {analysis.marketPhase}
          </div>
        )}
        <div className="bg-purple-500/20 text-purple-400 border border-purple-500/30 px-2 py-0.5 rounded text-[10px] font-mono">QUANTUM ENGINE ACTIVE</div>
      </div>

      <div ref={chartContainerRef} className="w-full h-full" />
    </div>
  );
}
