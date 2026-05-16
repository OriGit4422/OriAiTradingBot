import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Shield, Calculator, TrendingUp, TrendingDown, Info } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface RiskCalculatorProps {
  defaultEntry?: number;
  defaultSymbol?: string;
}

export function RiskCalculator({ defaultEntry = 0, defaultSymbol = 'BTC' }: RiskCalculatorProps) {
  const { data: walletData } = useQuery<any>({ queryKey: ['/api/wallet'] });

  const [riskPercent, setRiskPercent] = useState(2);
  const [entry, setEntry] = useState(defaultEntry > 0 ? defaultEntry.toString() : '');
  const [stopLoss, setStopLoss] = useState('');
  const [takeProfit, setTakeProfit] = useState('');
  const [direction, setDirection] = useState<'LONG' | 'SHORT'>('LONG');
  const [leverage, setLeverage] = useState(10);

  const accountBalance = walletData?.balance || 10000;

  const calc = useMemo(() => {
    const entryNum = parseFloat(entry) || 0;
    const slNum = parseFloat(stopLoss) || 0;
    const tpNum = parseFloat(takeProfit) || 0;

    if (!entryNum || !slNum) {
      return { riskAmount: 0, positionSizeUsdt: 0, units: 0, marginRequired: 0, rr: 0, stopDistPct: 0, valid: false };
    }

    const riskAmount = accountBalance * (riskPercent / 100);
    const stopDistAbs = Math.abs(entryNum - slNum);
    const stopDistPct = entryNum > 0 ? stopDistAbs / entryNum : 0;

    if (stopDistPct === 0) return { riskAmount, positionSizeUsdt: 0, units: 0, marginRequired: 0, rr: 0, stopDistPct: 0, valid: false };

    const positionSizeUsdt = riskAmount / stopDistPct;
    const units = entryNum > 0 ? positionSizeUsdt / entryNum : 0;
    const marginRequired = positionSizeUsdt / leverage;

    let rr = 0;
    if (tpNum && entryNum && slNum) {
      const profit = Math.abs(tpNum - entryNum);
      const loss = Math.abs(entryNum - slNum);
      rr = loss > 0 ? profit / loss : 0;
    }

    const isValidSL = direction === 'LONG' ? slNum < entryNum : slNum > entryNum;
    const isValidTP = tpNum ? (direction === 'LONG' ? tpNum > entryNum : tpNum < entryNum) : true;

    return {
      riskAmount,
      positionSizeUsdt,
      units,
      marginRequired,
      rr,
      stopDistPct: stopDistPct * 100,
      valid: isValidSL && isValidTP,
    };
  }, [accountBalance, riskPercent, entry, stopLoss, takeProfit, direction, leverage]);

  const rrColor = calc.rr >= 3 ? 'text-green-500' : calc.rr >= 2 ? 'text-yellow-500' : calc.rr >= 1 ? 'text-orange-500' : 'text-red-500';

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b border-border flex items-center gap-2 bg-gradient-to-r from-orange-500/10 to-red-500/5">
        <div className="h-6 w-6 rounded-md bg-orange-500/20 flex items-center justify-center">
          <Calculator className="w-3.5 h-3.5 text-orange-500" />
        </div>
        <div>
          <span className="text-xs font-black uppercase tracking-widest text-orange-600">Risk Calculator</span>
          <div className="text-[9px] text-muted-foreground font-mono">Position sizing · R:R ratio</div>
        </div>
      </div>

      <div className="flex-1 p-3 space-y-3 overflow-auto">
        {/* Direction Toggle */}
        <div className="flex rounded-lg overflow-hidden border border-border">
          <button
            className={cn('flex-1 py-1.5 text-xs font-bold transition-all flex items-center justify-center gap-1.5',
              direction === 'LONG' ? 'bg-green-500 text-white' : 'bg-muted/30 text-muted-foreground hover:bg-green-50')}
            onClick={() => setDirection('LONG')}
          >
            <TrendingUp className="w-3 h-3" /> LONG
          </button>
          <button
            className={cn('flex-1 py-1.5 text-xs font-bold transition-all flex items-center justify-center gap-1.5',
              direction === 'SHORT' ? 'bg-red-500 text-white' : 'bg-muted/30 text-muted-foreground hover:bg-red-50')}
            onClick={() => setDirection('SHORT')}
          >
            <TrendingDown className="w-3 h-3" /> SHORT
          </button>
        </div>

        {/* Account + Risk % */}
        <div className="bg-muted/20 rounded-lg p-2.5 border border-border/40">
          <div className="flex items-center justify-between mb-2">
            <Label className="text-[10px] font-mono uppercase text-muted-foreground">Account Balance</Label>
            <span className="text-xs font-mono font-bold">${accountBalance.toLocaleString()}</span>
          </div>
          <div className="flex items-center justify-between mb-1">
            <Label className="text-[10px] font-mono uppercase text-muted-foreground">Risk Per Trade</Label>
            <span className={cn('text-xs font-mono font-bold', riskPercent <= 1 ? 'text-green-500' : riskPercent <= 2 ? 'text-yellow-500' : 'text-red-500')}>
              {riskPercent}% · ${(accountBalance * riskPercent / 100).toFixed(0)}
            </span>
          </div>
          <Slider
            value={[riskPercent]}
            onValueChange={([v]) => setRiskPercent(v)}
            min={0.5} max={5} step={0.5}
            className="mt-1"
          />
          <div className="flex justify-between text-[9px] text-muted-foreground font-mono mt-1">
            <span>0.5%</span><span className="text-green-500">Safe ≤1%</span><span>5%</span>
          </div>
        </div>

        {/* Price Inputs */}
        <div className="space-y-2">
          <div>
            <Label className="text-[10px] font-mono uppercase text-muted-foreground">Entry Price</Label>
            <Input
              type="number"
              placeholder="e.g. 50000"
              value={entry}
              onChange={e => setEntry(e.target.value)}
              className="mt-1 h-7 text-xs font-mono bg-muted/20"
            />
          </div>
          <div>
            <Label className="text-[10px] font-mono uppercase text-muted-foreground flex items-center gap-1">
              Stop Loss
              {entry && stopLoss && (
                <span className={cn('ml-1 text-[9px]', calc.valid ? 'text-green-500' : 'text-red-500')}>
                  {calc.stopDistPct.toFixed(2)}% away
                </span>
              )}
            </Label>
            <Input
              type="number"
              placeholder={direction === 'LONG' ? 'Below entry' : 'Above entry'}
              value={stopLoss}
              onChange={e => setStopLoss(e.target.value)}
              className="mt-1 h-7 text-xs font-mono bg-muted/20"
            />
          </div>
          <div>
            <Label className="text-[10px] font-mono uppercase text-muted-foreground">Take Profit (optional)</Label>
            <Input
              type="number"
              placeholder={direction === 'LONG' ? 'Above entry' : 'Below entry'}
              value={takeProfit}
              onChange={e => setTakeProfit(e.target.value)}
              className="mt-1 h-7 text-xs font-mono bg-muted/20"
            />
          </div>

          {/* Leverage */}
          <div className="bg-muted/20 rounded-lg p-2 border border-border/40">
            <div className="flex items-center justify-between mb-1">
              <Label className="text-[10px] font-mono uppercase text-muted-foreground">Leverage</Label>
              <span className="text-xs font-mono font-bold text-primary">{leverage}x</span>
            </div>
            <Slider
              value={[leverage]}
              onValueChange={([v]) => setLeverage(v)}
              min={1} max={50} step={1}
            />
          </div>
        </div>

        {/* Results */}
        {calc.valid && calc.positionSizeUsdt > 0 ? (
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2">
            <div className="flex items-center gap-1 mb-1">
              <Shield className="w-3.5 h-3.5 text-primary" />
              <span className="text-[10px] font-black uppercase font-mono text-primary">Calculation Result</span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Risk Amount</span>
                <span className="font-mono font-bold text-red-500">${calc.riskAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Position Size</span>
                <span className="font-mono font-bold">${calc.positionSizeUsdt.toFixed(0)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Units</span>
                <span className="font-mono font-bold">{calc.units.toFixed(4)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Margin Req.</span>
                <span className="font-mono font-bold text-orange-500">${calc.marginRequired.toFixed(2)}</span>
              </div>
            </div>
            {calc.rr > 0 && (
              <div className="flex items-center justify-between pt-1 border-t border-border/40">
                <span className="text-xs text-muted-foreground">Risk : Reward</span>
                <div className="flex items-center gap-2">
                  <span className={cn('text-sm font-black font-mono', rrColor)}>1 : {calc.rr.toFixed(2)}</span>
                  <Badge variant="outline" className={cn('text-[9px]', calc.rr >= 2 ? 'border-green-200 text-green-600 bg-green-50' : 'border-orange-200 text-orange-600 bg-orange-50')}>
                    {calc.rr >= 3 ? 'Excellent' : calc.rr >= 2 ? 'Good' : calc.rr >= 1 ? 'Acceptable' : 'Poor'}
                  </Badge>
                </div>
              </div>
            )}
          </div>
        ) : entry && stopLoss ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 flex items-center gap-2">
            <Info className="w-3.5 h-3.5 text-red-500 shrink-0" />
            <span className="text-[10px] text-red-600">
              Invalid SL for {direction}. {direction === 'LONG' ? 'SL must be below entry.' : 'SL must be above entry.'}
            </span>
          </div>
        ) : (
          <div className="rounded-lg border border-border/40 bg-muted/20 p-2.5 flex items-center gap-2">
            <Info className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span className="text-[10px] text-muted-foreground">Enter entry and stop loss to calculate position size.</span>
          </div>
        )}
      </div>
    </div>
  );
}
