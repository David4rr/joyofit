// Port of HuaweiStressHRVCalculation.java and HuaweiStressScoreCalculation.java (Gadgetbridge, Me7c7): the 10 HRV features and the score the
// watch takes with its automatic stress switch. The Java mixes int, float and double arithmetic and every operand type decides a rounding,
// so each expression keeps the Java operand types (Float where Java has float, Double where an operand is a double literal or a Math.*
// call). The results are compared bit for bit with the Java in StressCalculationTests.
import Foundation

/// `Math.min` / `Math.max` on floats: NaN wins, like Java (Swift's `min`/`max` do not propagate it).
func javaMin(_ a: Float, _ b: Float) -> Float { a.isNaN || b.isNaN ? .nan : (a < b ? a : (b < a ? b : (a.sign == .minus ? a : b))) }
func javaMax(_ a: Float, _ b: Float) -> Float { a.isNaN || b.isNaN ? .nan : (a > b ? a : (b > a ? b : (a.sign == .minus ? b : a))) }

/// `Float.compare`: -0.0 below 0.0, NaN above everything and equal to itself.
func javaFloatCompare(_ a: Float, _ b: Float) -> Int {
    if a < b { return -1 }
    if a > b { return 1 }
    let x = Int32(bitPattern: a.isNaN ? 0x7fc0_0000 : a.bitPattern)
    let y = Int32(bitPattern: b.isNaN ? 0x7fc0_0000 : b.bitPattern)
    return x == y ? 0 : (x < y ? -1 : 1)
}

public struct StressHRVCalculation {
    public init() {}

    // MARK: outliers

    private func calculateAndRemoveOutliers(_ rri: [Int], _ outliers: inout [UInt8]) -> Int {
        var dataSum = 0
        var outlierCount = 0
        for i in 0..<rri.count {
            if rri[i] <= 400 || rri[i] >= 1400 {
                outliers[i] = 1
                outlierCount += 1
            } else {
                dataSum += rri[i]
            }
        }
        if rri.count == outlierCount { return -1 }
        var firstNotOutlierIndex = -1
        let averageValue = Float(dataSum) / Float(rri.count - outlierCount)
        for i in 0..<rri.count where outliers[i] == 0 {
            let currentRri = Float(rri[i])
            if Double(currentRri) <= Double(averageValue) * 1.2 && Double(currentRri) >= Double(averageValue) * 0.8 {
                if firstNotOutlierIndex < 0 { firstNotOutlierIndex = i }
            } else {
                outliers[i] = 1
            }
        }
        if firstNotOutlierIndex < 0 { return -1 }
        var prevValue = rri[firstNotOutlierIndex]
        var i = firstNotOutlierIndex + 1
        while i < rri.count {
            if outliers[i] == 0 {
                let currentRri = Float(rri[i])
                if Double(currentRri) <= Double(prevValue) * 0.8 || Double(currentRri) >= Double(prevValue) * 1.2 { outliers[i] = 1 }
                prevValue = rri[i]
            }
            i += 1
        }
        return firstNotOutlierIndex
    }

    // MARK: time domain

    struct TimeDomainData {
        var medianNNICount: Int16 = 0
        var sdHR: Float = 0
        var rangeNNI: Int16 = 0
        var rmsSD: Float = 0
        var medianNNI: Int16 = 0
        var normVar: Float = 0
        var rriCount: Int16 = 0
        var meanHR: Float = 0
        var pNN50: Float = 0
        var sdNN: Float = 0
    }

    private func calculateTimeDomain(_ rri: [Int], _ firstNotOutlierIndex: Int, _ outliers: [UInt8]) -> TimeDomainData? {
        var result = TimeDomainData()
        var rriMax = rri[firstNotOutlierIndex]
        var rriMin = rri[firstNotOutlierIndex]
        var rri50Count = 0
        var rriCount = 0
        var rriDiffSum = 0
        var rriDiffSqrtSum = 0
        var rriSum = 0
        var hrSum: Float = 0
        var previousValue = 0
        var isFirstValue = true
        for i in 0..<rri.count where outliers[i] == 0 && rri[i] != 0 {
            rriSum += rri[i]
            hrSum += Float(60000.0) / Float(rri[i])
            rriMax = max(rri[i], rriMax)
            rriMin = min(rri[i], rriMin)
            if !isFirstValue {
                rriCount += 1
                let diff = rri[i] - previousValue
                rriDiffSum += diff
                if abs(diff) > 50 { rri50Count += 1 }
                rriDiffSqrtSum += diff * diff
            }
            previousValue = rri[i]
            isFirstValue = false
        }
        if rriCount == 0 { return nil }
        result.rriCount = Int16(truncatingIfNeeded: rriCount + 1)
        result.meanHR = hrSum / Float(rriCount + 1)
        result.pNN50 = (Float(rri50Count) / Float(rriCount)) * 100.0

        let rriMinBy20 = (rriMin / 20) * 20
        let rriMaxBy20 = (rriMax / 20) * 20
        let categoriesNumber = ((rriMaxBy20 - rriMinBy20) / 20) + 1
        if categoriesNumber >= 50 { return nil }

        var categoriesBy20 = [Int](repeating: 0, count: categoriesNumber + 1)
        var categoriesCount = [Int8](repeating: 0, count: categoriesNumber + 1)
        for i in 0...categoriesNumber { categoriesBy20[i] = rriMinBy20 + (i * 20) }

        var hrDiffSqrtSum: Float = 0
        var rrDiffSqrtSum: Float = 0
        let avrRR = Float(rriSum) / Float(result.rriCount)
        for i in 0..<rri.count where outliers[i] == 0 && rri[i] != 0 {
            let rrDiff = Float(rri[i]) - avrRR
            rrDiffSqrtSum += rrDiff * rrDiff
            let hrDiff = Double(Float(60000.0)) / Double(rri[i]) - Double(result.meanHR)
            hrDiffSqrtSum += Float(hrDiff * hrDiff)
            for j in 0..<categoriesNumber where categoriesBy20[j] <= rri[i] && rri[i] < categoriesBy20[j] + 20 {
                categoriesCount[j] &+= 1  // a Java byte
                break
            }
        }
        result.sdHR = Float(Double(hrDiffSqrtSum / Float(rriCount + 1)).squareRoot())
        result.sdNN = Float(Double(rrDiffSqrtSum / Float(rriCount + 1)).squareRoot())
        result.rmsSD = Float(Double(Float(rriDiffSqrtSum) / Float(rriCount)).squareRoot())

        let avgDiffSqrt = Float(rriDiffSum * rriDiffSum) / Float(rriCount)
        let varSum = Float(Double((Float(rriDiffSqrtSum) - avgDiffSqrt) / Float(rriCount)).squareRoot() / Double(Float(1.4142135)))
        let varDiff = (rrDiffSqrtSum / Float(rriCount)) * 2 - (varSum * varSum)
        if Float(Double(varDiff).squareRoot()) == 0.0 { return nil }
        result.normVar = varSum / Float(Double(varDiff).squareRoot())

        var sectionSum = 0
        var sectionCount = 0
        var maxValue = 0
        for i in 0..<categoriesNumber {
            if categoriesCount[i] == 0 { continue }
            if Int(categoriesCount[i]) > maxValue {
                maxValue = Int(categoriesCount[i])
                sectionCount = 1
                sectionSum = i
                continue
            }
            if Int(categoriesCount[i]) == maxValue {
                sectionCount += 1
                sectionSum += i
            }
        }
        if sectionCount == 0 { return nil }
        let meanCategoriesIndex = Int(Double(Float(sectionSum) / Float(sectionCount)) + 0.5)
        result.medianNNICount = Int16(categoriesCount[meanCategoriesIndex])
        result.medianNNI = Int16(truncatingIfNeeded: categoriesBy20[meanCategoriesIndex])
        result.rangeNNI = Int16(truncatingIfNeeded: rriMaxBy20 - rriMinBy20)
        return result
    }

    // MARK: resampling

    private func interpolateRriData(
        _ rri: [Int], _ cumulative: [Int], _ baseValue: Float, _ resample: inout [Float], _ maxSamples: Int, _ outliers: [UInt8]
    ) -> Int {
        var targetValue: Float = 0
        var previousCumulative: Float = 0
        var lastRri: Float = 0
        var currIdx = 0
        var resampleIdx = 0
        for i in 0..<rri.count {
            if outliers[i] != 0 { continue }
            if resampleIdx > 129 { return 0 }
            if currIdx == 0 {
                resample[resampleIdx] = Float(rri[i])
                targetValue = baseValue + 0.5
                previousCumulative = baseValue
                lastRri = Float(rri[i])
                resampleIdx += 1
                currIdx = 1
            } else {
                let currentCumulative = Float(Double(cumulative[i]) / 1000.0)
                let cumulativeDelta = currentCumulative - targetValue
                if Double(cumulativeDelta) >= -0.0001 {
                    if currentCumulative == previousCumulative { return 0 }
                    resample[resampleIdx] = lastRri + ((Float(rri[i]) - lastRri) / (currentCumulative - previousCumulative)) * (targetValue - previousCumulative)
                    resampleIdx += 1
                    currIdx += 1
                    if currIdx == maxSamples { break }
                    targetValue = baseValue + (Float(currIdx) * 0.5)
                    var j = currIdx
                    while j < maxSamples {
                        if currentCumulative == previousCumulative || Double(currentCumulative - targetValue) < -0.0001 { break }
                        if resampleIdx > 129 { return 0 }
                        resample[resampleIdx] = lastRri + ((Float(rri[i]) - lastRri) / (currentCumulative - previousCumulative)) * (targetValue - previousCumulative)
                        resampleIdx += 1
                        currIdx += 1
                        if currIdx == maxSamples { break }
                        targetValue = baseValue + (Float(currIdx) * 0.5)
                        j += 1
                    }
                    lastRri = Float(rri[i])
                    previousCumulative = currentCumulative
                    if currIdx == maxSamples { break }
                } else if Double(cumulativeDelta) < -0.0001 {
                    lastRri = Float(rri[i])
                    previousCumulative = currentCumulative
                }
            }
        }
        return resampleIdx
    }

    private func applyHanningWindow(_ resample: inout [Float], _ maxLimit: Int, _ length: Int) -> Bool {
        if length >= maxLimit || length == 0 || maxLimit <= 128 { return false }
        let halfLength = length / 2
        if halfLength >= maxLimit { return false }
        let isLengthEven = length % 2 == 0

        if (length > 255 && isLengthEven) || (length > 256 && !isLengthEven) {
            for n in 0..<128 {
                let angle = (Double(n + 1) * 2.0 * Double.pi) / Double(length + 1)
                resample[n] = resample[n] * Float((1.0 - cos(angle)) * 0.5)
            }
            return true
        }
        if halfLength != 0 {
            var n2 = length - 1
            for n in 0..<halfLength {
                let angle = (Double(n + 1) * 2.0 * Double.pi) / Double(length + 1)
                let window = Float((1.0 - cos(angle)) * 0.5)
                resample[n] = resample[n] * window
                if n2 < 0 { return true }
                if length < 129 {
                    resample[n2] = resample[n2] * window
                } else if length - 128 <= n {
                    resample[n2] = resample[n2] * window
                }
                n2 -= 1
            }
        }
        if isLengthEven { return true }
        let midIndex = ((length + 1) / 2) - 1
        if midIndex >= 0 && midIndex < maxLimit {
            let angle = (Double(midIndex + 1) * 2.0 * Double.pi) / Double(length + 1)
            resample[midIndex] = Float(Double(resample[midIndex]) * (1.0 - cos(angle)) * 0.5)
            return true
        }
        return false
    }

    private func prepareFrequencyDomainData(
        _ firstNotOutlierIndex: Int, _ rri: [Int], _ cumulative: [Int], _ resample: inout [Float], _ outliers: [UInt8]
    ) -> Int {
        var baseSumValue = cumulative[0]
        if firstNotOutlierIndex > 0 { baseSumValue = cumulative[firstNotOutlierIndex] }
        let timeSpan = Double(cumulative[cumulative.count - 1] - baseSumValue) / 1000.0

        let resampleSize = interpolateRriData(rri, cumulative, Float(Double(baseSumValue) / 1000.0), &resample, Int(timeSpan * 2) + 1, outliers)
        if resampleSize == 0 || resampleSize >= resample.count { return 0 }

        // Detrending data
        var sumValues: Float = 0
        var sumSqrtIdx = 0
        var sumIdx = 0
        var sumIdxValues: Float = 0
        for i in 0..<resampleSize {
            sumIdx += i
            sumSqrtIdx += i * i
            sumValues += resample[i]
            sumIdxValues += Float(i) * resample[i]
        }
        let meanIndex = Float(sumIdx) / Float(resampleSize)
        let varianceTerm = Float(sumSqrtIdx) - (Float(resampleSize) * meanIndex * meanIndex)
        if varianceTerm == 0.0 { return 0 }

        let meanValue = sumValues / Float(resampleSize)
        let slope = (sumIdxValues - (Float(resampleSize) * meanIndex * meanValue)) / varianceTerm
        let intercept = meanValue - (slope * meanIndex)
        for i in 0..<resampleSize { resample[i] -= intercept + slope * Float(i) }

        if !applyHanningWindow(&resample, resample.count, resampleSize) { return 0 }
        return resampleSize
    }

    // MARK: frequency domain

    struct FrequencyDomainData {
        var freqStep: Float = 0
        var lfCount = 0
        var vlfCount = 0
        var hfCount = 0
        var totalPsd: Float = 0
        var peakPower: Float = 0
        var peakFrequency: Float = 0
        var vlfSamples = [Float](repeating: 0, count: 10)
        var hfSamples = [Float](repeating: 0, count: 40)
        var vlfPsd: Float = 0
        var hfPsd: Float = 0
        var lfPsd: Float = 0
        var lfHfVlfTotalPsd: Float = 0
        var vlfPeakIndex = 0
        var hfPeakIndex = 0
    }

    private func transformComplexComponents(_ fft: inout [Float], _ size: Int, _ stepSize: Int) -> Bool {
        if size >= 129 { return false }
        var i = 0
        while i < size {
            let rP1 = fft[i * 2]
            let iP1 = fft[(i * 2) + (stepSize * 2)]
            let rP2 = fft[(i * 2) + 1]
            let iP2 = fft[(i * 2) + (stepSize * 2) + 1]
            fft[(i * 2) + (stepSize * 2)] = rP1 - iP1
            fft[(i * 2) + (stepSize * 2) + 1] = rP2 - iP2
            fft[i * 2] = rP1 + iP1
            fft[(i * 2) + 1] = rP2 + iP2
            i += stepSize * 2
        }
        return true
    }

    private func computeFFTStage(_ stageIndex: Int, _ butterflyStep: Int, _ fft: inout [Float], _ maxIndex: Int, _ sinCos: [Float]) -> Bool {
        if maxIndex >= 129 { return false }
        var sinCosIdx = (stageIndex - 1) * 2
        var i = 1
        while i < butterflyStep {
            var j = i
            while j < maxIndex {
                let iPCurr = fft[(j * 2) + 1]
                let iPNext = fft[(j * 2) + (butterflyStep * 2) + 1]
                let rPCurr = fft[j * 2]
                let rpNext = fft[(j * 2) + (butterflyStep * 2)]
                let rDiff = rPCurr - rpNext
                let iDiff = iPCurr - iPNext
                fft[(j * 2) + (butterflyStep * 2)] = (sinCos[sinCosIdx] * rDiff) - (sinCos[sinCosIdx + 1] * iDiff)
                fft[(j * 2) + (butterflyStep * 2) + 1] = (sinCos[sinCosIdx + 1] * rDiff) + (sinCos[sinCosIdx] * iDiff)
                fft[j * 2] = rPCurr + rpNext
                fft[(j * 2) + 1] = iPCurr + iPNext
                j += butterflyStep * 2
            }
            sinCosIdx += stageIndex * 2
            i += 1
        }
        return true
    }

    private func swapComplexComponents(_ data: inout [Float], _ indexA: Int, _ indexB: Int) {
        let tempR = data[indexB * 2]
        let tempI = data[(indexB * 2) + 1]
        data[indexB * 2] = data[indexA * 2]
        data[(indexB * 2) + 1] = data[(indexA * 2) + 1]
        data[indexA * 2] = tempR
        data[(indexA * 2) + 1] = tempI
    }

    private func performFFT(_ fft: inout [Float], _ currentSize: Int) -> Bool {
        let halfSize = currentSize / 2
        let halfSize1 = halfSize - 1
        if currentSize == 0 || halfSize * 2 == 0 { return false }

        var sinCos = [Float](repeating: 0, count: halfSize1 * 2)
        let x = Double.pi / Double(halfSize)
        let cosX = Float(cos(x))
        let sinX = -Float(sin(x))
        var cosCurr = cosX
        var sinCurr = sinX
        for i in 0..<halfSize1 {
            sinCos[i * 2] = cosCurr
            sinCos[(i * 2) + 1] = sinCurr
            let tmp = cosCurr * sinX
            cosCurr = (cosCurr * cosX) - (sinCurr * sinX)
            sinCurr = (sinCurr * cosX) + tmp
        }

        var partitionSize = currentSize
        var butterflyStep = 1
        for _ in 0..<currentSize {
            partitionSize /= 2
            if !transformComplexComponents(&fft, currentSize, partitionSize) { return false }
            if !computeFFTStage(butterflyStep, partitionSize, &fft, currentSize, sinCos) { return false }
            if partitionSize == 1 { break }
            butterflyStep *= 2
        }

        // Bit-reversal
        let swapBoundary = currentSize / 2
        var sIdx = 0
        var tIdx = 1
        while tIdx < currentSize - 1 {
            var n1 = swapBoundary
            while sIdx >= n1 {
                sIdx -= n1
                n1 /= 2
            }
            sIdx = n1 + sIdx
            if sIdx > tIdx { swapComplexComponents(&fft, tIdx, sIdx) }
            tIdx += 1
        }
        return true
    }

    private func calculateFFT(_ resample: inout [Float], _ length: Int) -> Bool {
        let maxLength = resample.count - 2
        var fftData = [Float](repeating: 0, count: maxLength * 2)
        let curLen = min(length, maxLength)
        var j = 0
        var i = 0
        while i < curLen * 2 {
            fftData[i] = resample[j]
            fftData[i + 1] = 0.0
            j += 1
            i += 2
        }
        if !performFFT(&fftData, maxLength) { return false }

        for k in 0..<length { resample[k] = 0 }
        let maxHalfLength = (maxLength / 2) + 1
        if maxHalfLength == 0 { return false }

        var n = 0
        for k in 0..<maxHalfLength {
            resample[k] = ((fftData[n + 1] * fftData[n + 1] + fftData[n] * fftData[n]) * 2) / (Float(maxLength) * 0.5)
            n += 2
        }
        resample[0] = (fftData[1] * fftData[1] + fftData[0] * fftData[0]) / (Float(maxLength) * 0.5)
        let li = (maxHalfLength - 1) * 2
        resample[maxHalfLength - 1] = (fftData[li + 1] * fftData[li + 1] + fftData[li] * fftData[li]) / (Float(maxLength) * 0.5)
        return true
    }

    private func calculateFrequencyDomain(_ resample: inout [Float], _ length: Int, _ fd: inout FrequencyDomainData) -> Bool {
        fd.freqStep = 0.015625
        for n in 0..<65 {
            let currentFrequency = fd.freqStep * Float(n)
            resample[n] = Float(((Double(resample[n]) * 64.0) / Double(Float(length))) * 0.5)
            fd.totalPsd += fd.freqStep * resample[n]

            if fd.vlfCount >= fd.vlfSamples.count || fd.hfCount >= fd.hfSamples.count { return false }
            // VLF: 0.0 - 0.04 Hz, LF: 0.04 - 0.15 Hz, HF: 0.15 - 0.4 Hz
            if currentFrequency <= 0.4 {
                fd.lfHfVlfTotalPsd += fd.freqStep * resample[n]
                if currentFrequency >= 0.0 && currentFrequency < 0.04 {
                    fd.vlfPsd += fd.freqStep * resample[n]
                    fd.vlfSamples[fd.vlfCount] = resample[n]
                    fd.vlfCount += 1
                } else if currentFrequency >= 0.04 && currentFrequency < 0.15 {
                    fd.lfPsd += fd.freqStep * resample[n]
                    fd.lfCount += 1
                } else if currentFrequency >= 0.15 && currentFrequency <= 0.4 {
                    fd.hfPsd += fd.freqStep * resample[n]
                    fd.hfSamples[fd.hfCount] = resample[n]
                    fd.hfCount += 1
                }
                if currentFrequency >= 0.15 {
                    if fd.peakPower < resample[n] {
                        fd.peakPower = resample[n]
                        fd.peakFrequency = currentFrequency
                    }
                } else {
                    fd.peakPower = 0
                    fd.peakFrequency = 0
                }
            }
        }
        if fd.hfPsd == 0.0 || fd.totalPsd == 0.0 || fd.lfHfVlfTotalPsd == fd.vlfPsd || fd.lfHfVlfTotalPsd == 0.0 { return false }
        return true
    }

    private func processDataTrends(_ data: [Float], _ dataSize: Int, _ outputIndices: inout [Int], _ maxOutputSize: Int) -> Int {
        let trendCount = dataSize - 1
        var trends = [Int](repeating: 0, count: trendCount)
        for i in 0..<trendCount { trends[i] = javaFloatCompare(data[i], data[i + 1]) }
        var processedIndicesCount = 0
        var i = 0
        while i < dataSize - 2 && processedIndicesCount < maxOutputSize {
            let currentTrend = trends[i]
            let nextTrend = trends[i + 1]
            if nextTrend > currentTrend {
                trends[i] = 2
            } else if nextTrend != currentTrend {
                trends[i] = 0
            } else {
                trends[i] = 1
            }
            if trends[i] != 0 {
                outputIndices[processedIndicesCount] = i + 1
                processedIndicesCount += 1
            }
            i += 1
        }
        return processedIndicesCount
    }

    private func findDominantPeak(_ samples: [Float], _ length: Int) -> Int {
        if length == 0 { return -1 }
        var maxValue: Float = 0
        var maxValueIndex = 0
        for i in 0..<length where samples[i] > maxValue {
            maxValue = samples[i]
            maxValueIndex = i
        }
        if length < 3 { return maxValueIndex }

        var processedIndices = [Int](repeating: 0, count: 40)
        let validIndicesCount = processDataTrends(samples, length, &processedIndices, processedIndices.count)
        if validIndicesCount < 0 { return -1 }
        if validIndicesCount == 0 { return maxValueIndex }

        var peakValue: Float = 0
        var peakIndex = 0
        for i in 0..<validIndicesCount {
            let index = processedIndices[i]
            if index >= length { return -1 }
            if samples[index] > peakValue {
                peakIndex = index
                peakValue = samples[index]
            }
        }
        return peakIndex
    }

    private func calculateFrequencyDomainData(_ resample: inout [Float], _ length: Int) -> FrequencyDomainData? {
        var result = FrequencyDomainData()
        if !calculateFFT(&resample, length) { return nil }
        if !calculateFrequencyDomain(&resample, length, &result) { return nil }
        if result.freqStep == 0.0 { return nil }

        let peakEnd = Int((Double(result.peakFrequency) * 1.2) / Double(result.freqStep))
        if peakEnd >= length || result.totalPsd == 0.0 { return nil }

        let vlfPeakIndex = findDominantPeak(result.vlfSamples, result.vlfCount)
        let hfPeakIndex = findDominantPeak(result.hfSamples, result.hfCount)
        if hfPeakIndex < 0 || vlfPeakIndex < 0 { return nil }
        result.vlfPeakIndex = vlfPeakIndex
        result.hfPeakIndex = hfPeakIndex
        return result
    }

    private func calculateFrequencyDomain(_ rri: [Int], _ cumulative: [Int], _ firstNotOutlierIndex: Int, _ outliers: [UInt8]) -> FrequencyDomainData? {
        var resample = [Float](repeating: 0, count: 130)
        let resampleSize = prepareFrequencyDomainData(firstNotOutlierIndex, rri, cumulative, &resample, outliers)
        if resampleSize == 0 { return nil }
        return calculateFrequencyDomainData(&resample, resampleSize)
    }

    // MARK: features

    private func calculateHRV(_ rri: [Int], _ cumulative: [Int]) -> [Float]? {
        var outliers = [UInt8](repeating: 0, count: rri.count)
        let firstNotOutlierIndex = calculateAndRemoveOutliers(rri, &outliers)
        if firstNotOutlierIndex < 0 || firstNotOutlierIndex > rri.count { return nil }
        guard let td = calculateTimeDomain(rri, firstNotOutlierIndex, outliers) else { return nil }
        guard let fd = calculateFrequencyDomain(rri, cumulative, firstNotOutlierIndex, outliers) else { return nil }

        let pVlf = Float((Double(fd.vlfPsd / fd.lfHfVlfTotalPsd)) * 100.0)
        let pLf = Float((Double(fd.lfPsd / fd.lfHfVlfTotalPsd)) * 100.0)

        let medianNNICountOK = td.medianNNICount >= 0 && td.medianNNICount <= 600
        let sdHROK = Double(td.sdHR) >= 1.0 && Double(td.sdHR) <= 20.0
        let rangeNNIOK = td.rangeNNI >= 0 && td.rangeNNI <= 1000
        let rmsSDOK = Double(td.rmsSD) >= 0.0 && Double(td.rmsSD) <= 200.0
        let normVarOK = Double(td.normVar) >= 0.0 && Double(td.normVar) <= 2.0
        let pVlfOK = Double(pVlf) >= 0.0 && Double(pVlf) <= 100.0
        let nniOK = td.medianNNI >= 300 && td.medianNNI <= 1500

        if medianNNICountOK && sdHROK && rangeNNIOK && rmsSDOK && nniOK && normVarOK && pVlfOK {
            return [
                Float(td.medianNNICount), td.sdHR, Float(td.rangeNNI), pVlf, td.rmsSD, Float(td.medianNNI), td.normVar, fd.hfPsd, fd.lfPsd, pLf,
            ]
        }
        return nil
    }

    /// `calculateStressHRVParameters`: the 10 features of a measurement of `signalTime` seconds, or nil when GB's model refuses it (not 50
    /// to 70 s, not 30 to 210 intervals, too few of signal quality 100, too many outliers...).
    public func calculateStressHRVParameters(rri deviceRri: [Int], sqi deviceSqi: [Int], signalTime: Int) -> [Float]? {
        if signalTime <= 50 || signalTime >= 70 { return nil }
        if deviceRri.count < 30 || deviceRri.count > 210 || deviceRri.count > deviceSqi.count { return nil }

        var tmpRri: [Int] = []
        var tmpCumulative: [Int] = []
        var sum = 0
        for i in 0..<deviceRri.count {
            sum += deviceRri[i]
            if deviceSqi[i] == 100 {
                tmpRri.append(deviceRri[i])
                tmpCumulative.append(sum)
            }
        }
        if tmpRri.isEmpty || tmpRri.count < 30 { return nil }

        var total = 0
        var validCount = 0
        let filteredRri = tmpRri
        let cumulative = tmpCumulative
        for value in filteredRri where value >= 400 && value <= 1400 {
            total += value
            validCount += 1
        }
        if cumulative[cumulative.count - 1] > 65000 { return nil }
        if validCount == 0 || total == 0 { return nil }

        let sqi = (Float(60.0) / ((Float(total) / Float(validCount)) / 1000.0)) * (Float(signalTime) / 60.0)
        if Double(sqi) < 0.2 { return nil }
        return calculateHRV(filteredRri, cumulative)
    }
}

public enum StressScoreCalculation {
    private static let normalizationParams: [(Float, Float)] = [
        (19.381044, 9.474176), (5.5441837, 1.9308523), (184.17795, 54.48858), (33.487267, 25.893078), (32.97501, 16.267557),
        (677.911, 130.61485), (0.43178082, 0.1747625), (147.99915, 170.24158), (208.32425, 245.64342), (37.63596, 19.478745),
    ]
    private static let scoreInitValue: Float = 3.835272
    private static let coefficients: [Float] = [0.16605523, 0.24399279, 0.0, 0.0, -0.07095941, -0.20609115, 0.0, -0.14579488, -0.09786916, 0.0]
    private static let minScore: Float = 0
    private static let maxScore: Float = 7
    private static let outputMin = 15
    private static let outputMax = 90

    public static func calculateScoreFactor(_ features: [Float]) -> Float {
        var copy = features
        for i in 0..<normalizationParams.count {
            copy[i] = (copy[i] - normalizationParams[i].0) / normalizationParams[i].1
        }
        var score = scoreInitValue
        for i in 0..<coefficients.count { score += copy[i] * coefficients[i] }
        return javaMax(minScore, javaMin(score, maxScore))
    }

    /// `(int) float`: toward zero, saturating, NaN is 0.
    private static func javaInt(_ f: Float) -> Int {
        if f.isNaN { return 0 }
        if f >= 2_147_483_648 { return Int(Int32.max) }
        if f <= -2_147_483_648 { return Int(Int32.min) }
        return Int(f)
    }

    private static func calculateNormalizedScore(_ value: Float) -> Int {
        let score = javaInt((value * 14.0) + 1.5)
        return min(max(score, 1), 99)
    }

    /// A Java `byte`: always 15 to 90, so it is the same signed or not.
    public static func calculateNormalizedFinalScore(_ scoreFactor: Float) -> Int8 {
        let clamped = javaMax(minScore, javaMin(scoreFactor, maxScore))
        let clampedScore = calculateNormalizedScore(clamped)
        return Int8(min(max(clampedScore, outputMin), outputMax))
    }

    public static func calculateLevel(_ score: Int) -> Int8 {
        if score <= 29 { return 1 }
        if score <= 59 { return 2 }
        if score <= 79 { return 3 }
        return 4
    }
}
